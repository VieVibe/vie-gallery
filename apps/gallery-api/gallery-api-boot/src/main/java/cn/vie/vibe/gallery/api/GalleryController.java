package cn.vie.vibe.gallery.api;

import cn.vie.vibe.gallery.application.*;
import cn.vie.vibe.gallery.domain.*;
import cn.vie.vibe.gallery.infrastructure.security.SignedUrlService;
import cn.vie.vibe.gallery.infrastructure.security.SensitiveData;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@RestController
@RequestMapping("/api/galleries")
public class GalleryController {
    private final GalleryFacade facade;
    private final PhotoRepository photos;
    private final StorageObjectRepository objects;
    private final ObjectStoragePort storage;
    private final TenantContextResolver tenantContext;
    private final CreatorPreviewTokens previewTokens;
    private final PhotoProcessingTaskRepository tasks;
    private final GalleryViewerConfigRepository configs;
    private final SignedUrlService signedUrlService;

    public GalleryController(
            GalleryFacade facade,
            PhotoRepository photos,
            StorageObjectRepository objects,
            ObjectStoragePort storage,
            TenantContextResolver tenantContext,
            CreatorPreviewTokens previewTokens,
            SignedUrlService signedUrlService
    ) {
        this(facade, photos, objects, storage, tenantContext, previewTokens, null, null, signedUrlService);
    }

    @Autowired
    public GalleryController(
            GalleryFacade facade,
            PhotoRepository photos,
            StorageObjectRepository objects,
            ObjectStoragePort storage,
            TenantContextResolver tenantContext,
            CreatorPreviewTokens previewTokens,
            PhotoProcessingTaskRepository tasks,
            GalleryViewerConfigRepository configs,
            SignedUrlService signedUrlService
    ) {
        this.facade = facade;
        this.photos = photos;
        this.objects = objects;
        this.storage = storage;
        this.tenantContext = tenantContext;
        this.previewTokens = previewTokens;
        this.tasks = tasks;
        this.configs = configs;
        this.signedUrlService = signedUrlService;
    }

    @GetMapping
    public List<GalleryResponse> list() {
        UUID tenant = tenantContext.requireContext().tenantId();
        return facade.list().stream().map(g -> toResponse(g, tenant)).toList();
    }

    @GetMapping("/{galleryId}")
    public GalleryResponse get(@PathVariable UUID galleryId) {
        UUID tenant = tenantContext.requireContext().tenantId();
        return toResponse(facade.get(galleryId), tenant);
    }

    private GalleryResponse toResponse(Gallery gallery, UUID tenant) {
        int photoCount = photos != null ? photos.countPublicReadyByGalleryId(tenant, gallery.id()) : 0;
        String coverUrl = findCoverUrl(gallery, tenant, photoCount);
        TaskSummary taskSummary = tasks != null ? tasks.summaryByGallery(tenant, gallery.id()) : TaskSummary.empty();
        long failedPhotoCount = photos != null ? photos.countFailedByGalleryId(tenant, gallery.id()) : 0;
        long processingCount = taskSummary.queued() + taskSummary.processing() + taskSummary.cancelRequested();

        boolean hasUnpublishedConfig = false;
        if (configs != null) {
            Optional<GalleryViewerConfig> configOpt = configs.findByGalleryId(gallery.id());
            if (configOpt.isPresent()) {
                GalleryViewerConfig config = configOpt.get();
                hasUnpublishedConfig = config.hasUnpublishedChanges();
            }
        }

        return GalleryResponse.from(gallery, coverUrl, photoCount, failedPhotoCount, processingCount, hasUnpublishedConfig);
    }

    private String findCoverUrl(Gallery gallery, UUID tenant, int photoCount) {
        if (photos == null || objects == null || storage == null) return null;
        Optional<String> selected = Optional.ofNullable(gallery.coverPhotoId())
                .flatMap(id -> photos.findById(tenant, id))
                .filter(photo -> photo.galleryId().equals(gallery.id()) && photo.status() == PhotoStatus.READY)
                .flatMap(photo -> coverImageUrl(photo, tenant));
        String rawUrl = selected.orElseGet(() -> {
            if (photoCount == 0) return null;
            return photos.findPublicReadyByGalleryId(tenant, gallery.id(), 0, 1).stream()
                    .findFirst()
                    .flatMap(photo -> coverImageUrl(photo, tenant))
                    .orElse(null);
        });
        return rawUrl != null && signedUrlService != null ? signedUrlService.signPhotoUrl(rawUrl, tenant.toString()) : rawUrl;
    }

    private Optional<String> coverImageUrl(Photo photo, UUID tenant) {
        return objects.findById(tenant, photo.storageObjectId())
                .filter(object -> object.status() == StorageObjectStatus.READY)
                .map(object -> {
                    String key = object.thumbnailKey() != null ? object.thumbnailKey() : object.objectKey();
                    return storage.createReadUrl(key, ObjectStoragePort.DEFAULT_READ_URL_TTL).toString();
                });
    }

    @GetMapping("/{galleryId}/publish-readiness")
    public PublishReadinessResponse getPublishReadiness(@PathVariable UUID galleryId) {
        UUID tenant = tenantContext.requireContext().tenantId();
        Gallery gallery = facade.get(galleryId);
        int readyPhotoCount = photos != null ? photos.countPublicReadyByGalleryId(tenant, galleryId) : 0;

        java.util.List<PublishBlocker> blockers = new java.util.ArrayList<>();
        if (readyPhotoCount < 1) {
            blockers.add(new PublishBlocker("NO_READY_PHOTOS", "展厅中至少需要包含 1 张已处理完成的照片才能发布。"));
        }
        if (gallery.status() == GalleryStatus.ARCHIVED) {
            blockers.add(new PublishBlocker("GALLERY_ARCHIVED", "已归档的展厅无法重新发布。"));
        }
        if (gallery.visibility() == GalleryVisibility.PASSWORD &&
                (gallery.passwordHash() == null || gallery.passwordHash().isBlank())) {
            blockers.add(new PublishBlocker("PASSWORD_REQUIRED", "请先设置展厅访问密码，再发布展厅。"));
        }

        // A first publication must pin the recommended scene as a version snapshot.
        boolean configDraftChanged = true;
        String publishedVersionId = null;
        String draftVersionId = null;
        Instant lastConfigPublishedAt = null;

        if (configs != null) {
            Optional<GalleryViewerConfig> configOpt = configs.findByGalleryId(galleryId);
            if (configOpt.isPresent()) {
                GalleryViewerConfig cfg = configOpt.get();
                if (cfg.publishedVersionId() != null) {
                    publishedVersionId = cfg.publishedVersionId().toString();
                }
                lastConfigPublishedAt = cfg.lastPublishedAt();
                configDraftChanged = cfg.hasUnpublishedChanges();
                // Draft content lives on the config row until publish creates a version snapshot.
                draftVersionId = null;
            }
        }

        boolean galleryPublishable = blockers.isEmpty();
        return new PublishReadinessResponse(
                gallery.status(),
                readyPhotoCount,
                galleryPublishable,
                configDraftChanged,
                publishedVersionId,
                draftVersionId,
                gallery.publishedAt(),
                lastConfigPublishedAt,
                blockers
        );
    }

    @PostMapping("/{galleryId}/preview-token")
    public PreviewTokenResponse issuePreviewToken(@PathVariable UUID galleryId) {
        Gallery gallery = facade.get(galleryId);
        CreatorPreviewTokens.IssuedToken issued = previewTokens.issue(gallery.id());
        return new PreviewTokenResponse(issued.token(), issued.expiresAt());
    }

    @PostMapping("/{galleryId}/publish")
    public GalleryResponse publish(@PathVariable UUID galleryId) {
        UUID tenant = tenantContext.requireContext().tenantId();
        return toResponse(facade.publish(galleryId), tenant);
    }

    @PostMapping("/{galleryId}/unpublish")
    public GalleryResponse unpublish(@PathVariable UUID galleryId) {
        UUID tenant = tenantContext.requireContext().tenantId();
        return toResponse(facade.unpublish(galleryId), tenant);
    }

    @PutMapping("/{galleryId}/password")
    public GalleryResponse setPassword(@PathVariable UUID galleryId,
                                       @Valid @RequestBody SetPasswordRequest request) {
        UUID tenant = tenantContext.requireContext().tenantId();
        return toResponse(facade.setPassword(galleryId, request.password()), tenant);
    }

    @DeleteMapping("/{galleryId}/password")
    public GalleryResponse clearPassword(@PathVariable UUID galleryId) {
        UUID tenant = tenantContext.requireContext().tenantId();
        return toResponse(facade.clearPassword(galleryId), tenant);
    }

    @PatchMapping("/{galleryId}")
    public GalleryResponse update(@PathVariable UUID galleryId, @Valid @RequestBody UpdateGalleryRequest request) {
        UUID tenant = tenantContext.requireContext().tenantId();
        Gallery current = facade.get(galleryId);
        if (request.name() != null) {
            current = facade.rename(galleryId, request.name());
        }
        if (request.visibility() != null) {
            current = facade.updateVisibility(galleryId, request.visibility());
        }
        return toResponse(current, tenant);
    }

    @DeleteMapping("/{galleryId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID galleryId) {
        facade.delete(galleryId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public GalleryResponse create(@Valid @RequestBody CreateGalleryRequest request) {
        UUID tenant = tenantContext.requireContext().tenantId();
        return toResponse(facade.create(request.name().trim(), request.slug().trim(), request.visibility()), tenant);
    }

    public record UpdateGalleryRequest(GalleryVisibility visibility, @Size(max = 160) String name) {
    }

    public record CreateGalleryRequest(@NotBlank @Size(max = 160) String name,
                                       @NotBlank @Size(max = 80) String slug,
                                       GalleryVisibility visibility) {
        public CreateGalleryRequest { if (visibility == null) visibility = GalleryVisibility.PRIVATE; }
    }

    public record SetPasswordRequest(@NotBlank @Size(min = 6, max = 128) String password) {
    }

    public record PreviewTokenResponse(String token, Instant expiresAt) {
    }

    public record PublishBlocker(String code, String message) {
    }

    public record PublishReadinessResponse(
            GalleryStatus galleryStatus,
            int readyPhotoCount,
            boolean galleryPublishable,
            boolean configDraftChanged,
            String publishedConfigVersionId,
            String draftConfigVersionId,
            Instant publishedAt,
            Instant lastConfigPublishedAt,
            List<PublishBlocker> blockers
    ) {
    }

    public record GalleryResponse(
            String id,
            String slug,
            String name,
            GalleryVisibility visibility,
            GalleryStatus status,
            Instant publishedAt,
            String coverPhotoId,
            @SensitiveData(type = SensitiveData.SensitiveType.PHOTO_URL) String coverThumbnailUrl,
            Instant createdAt,
            Instant updatedAt,
            int photoCount,
            long failedPhotoCount,
            long processingCount,
            boolean hasUnpublishedConfig
    ) {
        static GalleryResponse from(Gallery gallery, String coverThumbnailUrl, int photoCount,
                                    long failedPhotoCount, long processingCount, boolean hasUnpublishedConfig) {
            return new GalleryResponse(
                    gallery.id().toString(),
                    gallery.slug(),
                    gallery.name(),
                    gallery.visibility(),
                    gallery.status(),
                    gallery.publishedAt(),
                    gallery.coverPhotoId() != null ? gallery.coverPhotoId().toString() : null,
                    coverThumbnailUrl,
                    gallery.createdAt(),
                    gallery.updatedAt() != null ? gallery.updatedAt() : gallery.createdAt(),
                    photoCount,
                    failedPhotoCount,
                    processingCount,
                    hasUnpublishedConfig
            );
        }

        static GalleryResponse from(Gallery gallery, String coverThumbnailUrl) {
            return from(gallery, coverThumbnailUrl, 0, 0, 0, false);
        }
    }
}
