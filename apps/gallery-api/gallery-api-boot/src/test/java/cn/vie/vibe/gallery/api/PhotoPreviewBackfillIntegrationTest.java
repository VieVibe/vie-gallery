package cn.vie.vibe.gallery.api;

import cn.vie.vibe.gallery.application.PhotoAssetVariantRepository;
import cn.vie.vibe.gallery.application.PhotoRepository;
import cn.vie.vibe.gallery.domain.PhotoAssetVariant;
import cn.vie.vibe.gallery.domain.VariantKind;
import cn.vie.vibe.gallery.infrastructure.persistence.MyBatisPhotoAssetVariantRepository;
import cn.vie.vibe.gallery.infrastructure.persistence.MyBatisPhotoRepository;
import cn.vie.vibe.gallery.infrastructure.persistence.mapper.PhotoAssetVariantMapper;
import cn.vie.vibe.gallery.infrastructure.persistence.mapper.PhotoMapper;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.MySQLContainer;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PhotoPreviewBackfillIntegrationTest {
    @Test
    void onlyActiveReadyPhotosWithMissingRenditionsAreSelectedAfterTheCursor() {
        Assumptions.assumeTrue(DockerClientFactory.instance().isDockerAvailable(), "Docker is unavailable");
        try (MySQLContainer<?> mysql = new MySQLContainer<>("mysql:8.4.0")) {
            mysql.start();
            var dataSource = new UnpooledDataSource(mysql.getDriverClassName(),
                    mysql.getJdbcUrl(), mysql.getUsername(), mysql.getPassword());
            Flyway.configure().dataSource(dataSource).load().migrate();

            var config = new Configuration(new Environment("test", new JdbcTransactionFactory(), dataSource));
            config.addMapper(PhotoAssetVariantMapper.class);
            config.addMapper(PhotoMapper.class);
            try (var session = new SqlSessionFactoryBuilder().build(config).openSession(true)) {
                verifyBackfill(new JdbcTemplate(dataSource),
                        new MyBatisPhotoAssetVariantRepository(session.getMapper(PhotoAssetVariantMapper.class)),
                        new MyBatisPhotoRepository(session.getMapper(PhotoMapper.class)));
            }
        }
    }

    private void verifyBackfill(JdbcTemplate jdbc, PhotoAssetVariantRepository variants, PhotoRepository photos) {
        UUID tenant = UUID.randomUUID();
        UUID gallery = UUID.randomUUID();
        jdbc.update("INSERT INTO tenant (id, name, slug, created_at, updated_at) VALUES (UUID_TO_BIN(?), 'Test', ?, NOW(6), NOW(6))",
                tenant.toString(), tenant.toString());
        jdbc.update("""
                INSERT INTO gallery (id, tenant_id, name, slug, created_at, updated_at)
                VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), 'Test', ?, NOW(6), NOW(6))
                """, gallery.toString(), tenant.toString(), gallery.toString());

        UUID cursor = UUID.fromString("ffffffff-ffff-ffff-ffff-fffffffffff0");
        UUID first = UUID.fromString("ffffffff-ffff-ffff-ffff-fffffffffff1");
        UUID second = UUID.fromString("ffffffff-ffff-ffff-ffff-fffffffffff2");
        UUID deleted = UUID.fromString("ffffffff-ffff-ffff-ffff-fffffffffff3");
        UUID firstObject = savePhoto(jdbc, tenant, gallery, first, true, false);
        UUID secondObject = savePhoto(jdbc, tenant, gallery, second, false, false);
        savePhoto(jdbc, tenant, gallery, deleted, false, true);
        variants.upsert(PhotoAssetVariant.ready(tenant, first, firstObject, VariantKind.PREVIEW,
                "small.webp", "image/webp", 100, 480, 320, null));

        var firstBatch = variants.findMissingPreviews(cursor, 1);
        assertEquals(List.of(new PhotoAssetVariantRepository.PreviewCandidate(
                tenant, first, firstObject, "thumbnail/" + first, "image/jpeg")), firstBatch);
        assertEquals(first, photos.findPublicReadyMarkedCover(tenant, gallery).orElseThrow().id());

        assertEquals(List.of(new PhotoAssetVariantRepository.PreviewCandidate(
                tenant, second, secondObject, "original/" + second, "image/png")), variants.findMissingPreviews(first, 4));
        variants.upsert(PhotoAssetVariant.ready(tenant, first, firstObject, VariantKind.COVER,
                "cover.webp", "image/webp", 200, 960, 640, null));
        assertEquals(second, variants.findMissingPreviews(cursor, 1).get(0).photoId());
        assertTrue(variants.findMissingPreviews(second, 4).isEmpty());
    }

    private UUID savePhoto(JdbcTemplate jdbc, UUID tenant, UUID gallery, UUID photo, boolean markedCover, boolean deleted) {
        UUID object = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO storage_object (id, tenant_id, bucket, object_key, thumbnail_key, mime_type, byte_size, status, created_at, updated_at)
                VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), 'preview-test', ?, ?, 'image/png', 100, 'READY', NOW(6), NOW(6))
                """, object.toString(), tenant.toString(), "original/" + photo, markedCover ? "thumbnail/" + photo : null);
        jdbc.update("""
                INSERT INTO photo (id, tenant_id, gallery_id, storage_object_id, is_cover, status, deleted_at, created_at, updated_at)
                VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, 'READY', IF(?, NOW(6), NULL), NOW(6), NOW(6))
                """, photo.toString(), tenant.toString(), gallery.toString(), object.toString(), markedCover, deleted);
        return object;
    }
}
