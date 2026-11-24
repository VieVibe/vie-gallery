package cn.vie.vibe.gallery.api.privatefiles;

import com.aliyun.oss.OSS;
import com.aliyun.oss.HttpMethod;
import com.aliyun.oss.model.CopyObjectRequest;
import com.aliyun.oss.model.GeneratePresignedUrlRequest;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.net.URL;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class PrivateSpaceStorageTest {
    @Test void onlyStagingReceivesUploadAuthorizationAndOriginalReadsNeverProcessImages() throws Exception {
        OSS oss = mock(OSS.class);
        when(oss.generatePresignedUrl(any(GeneratePresignedUrlRequest.class))).thenReturn(new URL("https://private.test/signed"));
        var properties = new PrivateSpaceProperties(true, UUID.randomUUID(), "https://oss.test", "key", "secret", "wedding-private", 32L << 30, 512L << 20);
        PrivateSpaceStorage storage = new PrivateSpaceConfiguration().privateSpaceStorage(oss, properties, "");
        var upload = storage.upload("staging/user/file");
        assertEquals("private", upload.headers().get("x-oss-object-acl"));
        assertEquals("application/octet-stream", upload.headers().get("Content-Type"));
        storage.seal("staging/user/file", "originals/user/file");
        storage.readUrl("originals/user/file");
        var signed = ArgumentCaptor.forClass(GeneratePresignedUrlRequest.class);
        verify(oss, times(2)).generatePresignedUrl(signed.capture());
        var put = signed.getAllValues().get(0); var get = signed.getAllValues().get(1);
        assertEquals(HttpMethod.PUT, put.getMethod()); assertEquals("staging/user/file", put.getKey());
        assertEquals("private", put.getHeaders().get("x-oss-object-acl"));
        assertEquals(HttpMethod.GET, get.getMethod()); assertEquals("originals/user/file", get.getKey());
        assertNull(get.getProcess()); assertTrue(get.getQueryParameter().isEmpty());
        assertNull(get.getResponseHeaders().getContentType(), "OSS rejects response-content-type on signed downloads");
        assertEquals("private, no-store", get.getResponseHeaders().getCacheControl());
        var copied = ArgumentCaptor.forClass(CopyObjectRequest.class);
        verify(oss).copyObject(copied.capture());
        assertEquals("wedding-private", copied.getValue().getDestinationBucketName());
        assertEquals("originals/user/file", copied.getValue().getDestinationKey());
        assertEquals("true", copied.getValue().getHeaders().get("x-oss-forbid-overwrite"));
        assertEquals("private", copied.getValue().getHeaders().get("x-oss-object-acl"));
        storage.close(); verify(oss, never()).shutdown(); // The public client bean owns its lifecycle.
    }

    @Test void enablingSpaceCannotReuseTheGalleryBucketOrLeakCredentialsInDiagnostics() {
        var properties = new PrivateSpaceProperties(true, UUID.randomUUID(), "https://oss.test", "key", "must-not-log-this", "gallery", 32L << 30, 512L << 20);
        assertThrows(IllegalStateException.class, () -> new PrivateSpaceConfiguration().privateSpaceOss(properties, "gallery"));
        assertFalse(properties.toString().contains("must-not-log-this"));
    }
}
