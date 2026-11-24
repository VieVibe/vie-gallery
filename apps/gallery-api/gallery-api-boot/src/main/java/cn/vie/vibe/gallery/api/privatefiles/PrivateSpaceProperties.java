package cn.vie.vibe.gallery.api.privatefiles;

import org.springframework.boot.context.properties.ConfigurationProperties;
import java.util.UUID;

@ConfigurationProperties("gallery.private-space")
public record PrivateSpaceProperties(boolean enabled, UUID userId, String endpoint,
                                     String accessKeyId, String accessKeySecret, String bucket,
                                     long quotaBytes, long maxFileBytes) {
    public boolean allows(UUID id) { return enabled && userId != null && userId.equals(id); }
    @Override public String toString() { return "PrivateSpaceProperties[enabled=" + enabled + ", credentials=REDACTED]"; }
}
