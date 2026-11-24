package cn.vie.vibe.gallery.api.privatefiles;

import com.aliyun.oss.OSS;
import com.aliyun.oss.OSSClientBuilder;
import com.aliyun.oss.HttpMethod;
import com.aliyun.oss.model.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.time.Instant;
import java.util.Date;
import java.util.Map;

@Configuration
@EnableConfigurationProperties(PrivateSpaceProperties.class)
public class PrivateSpaceConfiguration {
    @Bean(destroyMethod = "shutdown")
    @ConditionalOnProperty(name = "gallery.private-space.enabled", havingValue = "true")
    OSS privateSpaceOss(PrivateSpaceProperties p, @Value("${gallery.storage.aliyun.bucket}") String galleryBucket) {
        if (p.userId() == null || p.bucket() == null || p.bucket().isBlank() || p.bucket().equals(galleryBucket)
                || p.accessKeyId() == null || p.accessKeyId().isBlank()
                || p.accessKeySecret() == null || p.accessKeySecret().isBlank()
                || p.endpoint() == null || !p.endpoint().startsWith("https://")
                || p.quotaBytes() <= 0 || p.maxFileBytes() <= 0 || p.maxFileBytes() > 536870912L) {
            throw new IllegalStateException("Private space requires a dedicated bucket, user ID, HTTPS credentials and valid limits");
        }
        OSS client = new OSSClientBuilder().build(p.endpoint(), p.accessKeyId(), p.accessKeySecret());
        try {
            if (client.getBucketAcl(p.bucket()).getCannedACL() != CannedAccessControlList.Private) {
                throw new IllegalStateException("Private space bucket must be private");
            }
            return client;
        } catch (RuntimeException e) { client.shutdown(); throw e; }
    }

    @Bean(destroyMethod = "close")
    @ConditionalOnProperty(name = "gallery.private-space.enabled", havingValue = "true")
    PrivateSpaceStorage privateSpaceStorage(OSS privateSpaceOss, PrivateSpaceProperties p,
            @Value("${PRIVATE_SPACE_OSS_INTERNAL_ENDPOINT:}") String internalEndpoint) {
        if (!internalEndpoint.isBlank() && !internalEndpoint.startsWith("https://"))
            throw new IllegalStateException("Private space internal endpoint must use HTTPS");
        // Browser signatures use the public endpoint. Server verification can use
        // the same-region internal endpoint to avoid public egress for readbacks.
        OSS server = internalEndpoint.isBlank() ? privateSpaceOss
                : new OSSClientBuilder().build(internalEndpoint, p.accessKeyId(), p.accessKeySecret());
        return new PrivateSpaceStorage() {
            public Upload upload(String key) {
                GeneratePresignedUrlRequest request = new GeneratePresignedUrlRequest(p.bucket(), key, HttpMethod.PUT);
                request.setExpiration(Date.from(Instant.now().plusSeconds(3600)));
                request.setContentType("application/octet-stream");
                request.addHeader("x-oss-object-acl", "private");
                return new Upload(privateSpaceOss.generatePresignedUrl(request).toString(),
                        Map.of("Content-Type", "application/octet-stream", "x-oss-object-acl", "private"));
            }
            public void seal(String staging, String original) {
                CopyObjectRequest request = new CopyObjectRequest(p.bucket(), staging, p.bucket(), original);
                request.addHeader("x-oss-object-acl", "private");
                request.addHeader("x-oss-forbid-overwrite", "true");
                server.copyObject(request);
            }
            public InputStream open(String key) { return server.getObject(p.bucket(), key).getObjectContent(); }
            public String readUrl(String key) {
                GeneratePresignedUrlRequest request = new GeneratePresignedUrlRequest(p.bucket(), key, HttpMethod.GET);
                request.setExpiration(Date.from(Instant.now().plusSeconds(900)));
                ResponseHeaderOverrides response = new ResponseHeaderOverrides();
                // OSS rejects response-content-type overrides (0017-00000902).
                // The original already carries application/octet-stream metadata.
                response.setCacheControl("private, no-store");
                request.setResponseHeaders(response);
                return privateSpaceOss.generatePresignedUrl(request).toString();
            }
            public void putPreview(String key, byte[] jpeg) {
                ObjectMetadata meta = new ObjectMetadata();
                meta.setContentType("image/jpeg");
                meta.setContentLength(jpeg.length);
                PutObjectRequest request = new PutObjectRequest(p.bucket(), key, new ByteArrayInputStream(jpeg), meta);
                request.addHeader("x-oss-object-acl", "private");
                server.putObject(request);
            }
            public void close() { if (server != privateSpaceOss) server.shutdown(); }
        };
    }
}
