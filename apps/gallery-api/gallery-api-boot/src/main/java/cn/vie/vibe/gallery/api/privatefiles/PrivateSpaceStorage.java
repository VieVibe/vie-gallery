package cn.vie.vibe.gallery.api.privatefiles;

import java.io.InputStream;
import java.util.Map;

/** Separate bucket and keys; the client can write staging objects only. */
public interface PrivateSpaceStorage extends AutoCloseable {
    record Upload(String url, Map<String, String> headers) {}
    Upload upload(String stagingKey);
    void seal(String stagingKey, String originalKey);
    InputStream open(String key);
    String readUrl(String key);
    void putPreview(String key, byte[] jpeg);
    @Override default void close() {}
}
