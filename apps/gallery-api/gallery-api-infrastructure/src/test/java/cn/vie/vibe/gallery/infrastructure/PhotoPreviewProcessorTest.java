package cn.vie.vibe.gallery.infrastructure;

import cn.vie.vibe.gallery.application.PhotoAssetVariantRepository.PreviewCandidate;
import cn.vie.vibe.gallery.application.PhotoPreviewProcessor;
import cn.vie.vibe.gallery.domain.PhotoAssetVariant;
import cn.vie.vibe.gallery.domain.VariantKind;
import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class PhotoPreviewProcessorTest {
    private final UUID tenantId = UUID.randomUUID();
    private final UUID photoId = UUID.randomUUID();
    private final UUID objectId = UUID.randomUUID();
    private final DevObjectStorage storage = new DevObjectStorage();

    @Test
    void generatedPreviewsAreReadableWebpAndKeepTheirAspectRatio() throws IOException {
        var variants = new DevPhotoAssetVariantRepository();
        var processor = new PhotoPreviewProcessor(storage, variants, new ImageIoVariantProcessor());

        processor.generate(tenantId, photoId, objectId, jpeg(1200, 800));

        assertWebp(variants.findReadyByPhotoAndKind(tenantId, photoId, VariantKind.PREVIEW).orElseThrow(), 480, 320);
        assertWebp(variants.findReadyByPhotoAndKind(tenantId, photoId, VariantKind.COVER).orElseThrow(), 960, 640);
    }

    @Test
    void backfillPassesBrokenSourcesAndOnlyFillsMissingVariants() throws IOException {
        UUID brokenPhotoId = UUID.randomUUID();
        byte[] jpeg = jpeg(300, 600);
        storage.put("legacy/thumbnail", new ByteArrayInputStream(jpeg), "image/jpeg", jpeg.length);
        var variants = new DevPhotoAssetVariantRepository() {
            @Override
            public List<PreviewCandidate> findMissingPreviews(UUID afterPhotoId, int limit) {
                return afterPhotoId == null ? List.of(
                        new PreviewCandidate(tenantId, brokenPhotoId, UUID.randomUUID(), "missing", "image/jpeg"),
                        new PreviewCandidate(tenantId, photoId, objectId, "legacy/thumbnail", "image/jpeg")
                ) : List.of();
            }
        };
        PhotoAssetVariant existing = PhotoAssetVariant.ready(tenantId, photoId, objectId, VariantKind.COVER,
                "existing-cover.webp", "image/webp", 12, 300, 600, null);
        variants.upsert(existing);

        new PhotoPreviewProcessor(storage, variants, new ImageIoVariantProcessor()).backfillBatch();

        assertTrue(variants.findByPhoto(tenantId, brokenPhotoId).isEmpty());
        assertEquals(existing, variants.findReadyByPhotoAndKind(tenantId, photoId, VariantKind.COVER).orElseThrow());
        assertWebp(variants.findReadyByPhotoAndKind(tenantId, photoId, VariantKind.PREVIEW).orElseThrow(), 240, 480);
    }

    @Test
    void unavailableNativeEncoderLeavesTheLegacyImageUsable() throws IOException {
        var variants = new DevPhotoAssetVariantRepository();
        PhotoAssetVariant legacy = PhotoAssetVariant.ready(tenantId, photoId, objectId, VariantKind.HIGH,
                "legacy.jpg", "image/jpeg", 100, 1200, 800, null);
        variants.upsert(legacy);
        var processor = new PhotoPreviewProcessor(storage, variants, (type, source, spec) -> {
            throw new UnsatisfiedLinkError("Native WebP encoder is unavailable");
        });
        byte[] highImage = jpeg(1200, 800);

        assertDoesNotThrow(() -> processor.generate(tenantId, photoId, objectId, highImage));
        assertEquals(List.of(legacy), variants.findByPhoto(tenantId, photoId));
    }

    private void assertWebp(PhotoAssetVariant variant, int width, int height) throws IOException {
        assertEquals("image/webp", variant.mimeType());
        assertEquals(width, variant.width());
        assertEquals(height, variant.height());
        try (var input = storage.get(variant.objectKey())) {
            byte[] bytes = input.readAllBytes();
            assertEquals("WEBP", new String(bytes, 8, 4, java.nio.charset.StandardCharsets.US_ASCII));
            assertEquals(bytes.length, variant.byteSize());
            BufferedImage decoded = ImageIO.read(new ByteArrayInputStream(bytes));
            assertEquals(width, decoded.getWidth());
            assertEquals(height, decoded.getHeight());
        }
    }

    private static byte[] jpeg(int width, int height) throws IOException {
        var output = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB), "jpeg", output);
        return output.toByteArray();
    }
}
