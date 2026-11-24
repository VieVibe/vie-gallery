package cn.vie.vibe.gallery.application;

import cn.vie.vibe.gallery.application.ImageVariantProcessor.VariantSpec;
import cn.vie.vibe.gallery.domain.PhotoAssetVariant;
import cn.vie.vibe.gallery.domain.VariantKind;
import cn.vie.vibe.gallery.domain.VariantStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.UUID;

@Component
public class PhotoPreviewProcessor {
    private static final Logger log = LoggerFactory.getLogger(PhotoPreviewProcessor.class);
    private static final int BATCH_SIZE = 4;
    private static final Duration BETWEEN_SWEEPS = Duration.ofMinutes(10);
    private static final VariantSpec PREVIEW = new VariantSpec("PREVIEW", 480, "image/webp", 0.76);
    private static final VariantSpec COVER = new VariantSpec("COVER", 960, "image/webp", 0.82);

    private final ObjectStoragePort storage;
    private final PhotoAssetVariantRepository variants;
    private final ImageVariantProcessor images;
    private UUID afterPhotoId;
    private Instant nextSweep = Instant.EPOCH;

    public PhotoPreviewProcessor(ObjectStoragePort storage, PhotoAssetVariantRepository variants, ImageVariantProcessor images) {
        this.storage = storage;
        this.variants = variants;
        this.images = images;
    }

    public void generate(UUID tenantId, UUID photoId, UUID storageObjectId, byte[] thumbnail) {
        generate(tenantId, photoId, storageObjectId, "image/jpeg", thumbnail);
    }

    @Scheduled(initialDelayString = "${gallery.processing.preview-backfill-interval:30000}",
            fixedDelayString = "${gallery.processing.preview-backfill-interval:30000}")
    public void backfillBatch() {
        if (Instant.now().isBefore(nextSweep)) return;
        var candidates = variants.findMissingPreviews(afterPhotoId, BATCH_SIZE);
        for (var candidate : candidates) {
            afterPhotoId = candidate.photoId();
            byte[] source;
            try (var stream = storage.get(candidate.sourceKey())) {
                source = stream.readAllBytes();
            } catch (IOException | RuntimeException error) {
                log.warn("Could not read source for photo previews, photoId={}: {}", candidate.photoId(), error.toString());
                continue;
            }
            generate(candidate.tenantId(), candidate.photoId(), candidate.storageObjectId(), candidate.sourceType(), source);
        }
        if (candidates.size() < BATCH_SIZE) {
            // A failed source must not prevent later photos from being processed.
            afterPhotoId = null;
            nextSweep = Instant.now().plus(BETWEEN_SWEEPS);
        }
    }

    private void generate(UUID tenantId, UUID photoId, UUID storageObjectId, String sourceType, byte[] source) {
        EnumSet<VariantKind> ready = EnumSet.noneOf(VariantKind.class);
        try {
            for (var variant : variants.findByPhoto(tenantId, photoId)) {
                if (variant.storageObjectId().equals(storageObjectId) && variant.status() == VariantStatus.READY) {
                    ready.add(variant.kind());
                }
            }
        } catch (RuntimeException error) {
            log.warn("Could not check existing photo previews, photoId={}", photoId, error);
            return;
        }
        if (!ready.contains(VariantKind.PREVIEW)) {
            generate(tenantId, photoId, storageObjectId, sourceType, source, VariantKind.PREVIEW, PREVIEW, "preview-480.webp");
        }
        if (!ready.contains(VariantKind.COVER)) {
            generate(tenantId, photoId, storageObjectId, sourceType, source, VariantKind.COVER, COVER, "cover-960.webp");
        }
    }

    private void generate(UUID tenantId, UUID photoId, UUID storageObjectId, String sourceType, byte[] source,
                          VariantKind kind, VariantSpec spec, String filename) {
        // Keep retries on the same object key so a failed metadata write does not create extra objects.
        String key = "tenant/" + tenantId + "/photos/" + photoId + "/" + filename;
        try {
            var image = images.create(sourceType, new ByteArrayInputStream(source), spec);
            storage.put(key, new ByteArrayInputStream(image.content()), image.contentType(), image.content().length);
            variants.upsert(PhotoAssetVariant.ready(tenantId, photoId, storageObjectId, kind, key,
                    image.contentType(), image.content().length, image.width(), image.height(), null));
        } catch (RuntimeException | LinkageError error) {
            log.warn("Could not generate {} for photoId={}: {}", kind, photoId, error.toString());
        }
    }
}
