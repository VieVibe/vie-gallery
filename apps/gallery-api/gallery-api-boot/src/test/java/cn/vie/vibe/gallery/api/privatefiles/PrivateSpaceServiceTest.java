package cn.vie.vibe.gallery.api.privatefiles;

import cn.vie.vibe.gallery.api.privatefiles.PrivateSpaceRepository.FileRecord;
import cn.vie.vibe.gallery.domain.DomainException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.*;
import java.time.Instant;
import java.util.*;
import java.util.zip.ZipInputStream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PrivateSpaceServiceTest {
    final UUID owner = UUID.randomUUID();
    PrivateSpaceRepository repo;
    PrivateSpaceService service;
    final Map<UUID, FileRecord> records = new HashMap<>();
    final Map<String, byte[]> objects = new HashMap<>();
    PrivateSpaceStorage storage;

    @BeforeEach void setup() {
        repo = mock(PrivateSpaceRepository.class);
        PlatformTransactionManager manager = mock(PlatformTransactionManager.class);
        when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        when(repo.byId(eq(owner), any(), anyBoolean())).thenAnswer(call -> records.get(call.getArgument(1)));
        when(repo.list(owner)).thenAnswer(call -> new ArrayList<>(records.values()));
        when(repo.byPath(eq(owner), anyString())).thenAnswer(call -> records.values().stream().filter(file ->
                PrivateSpaceService.hex(PrivateSpaceService.digest().digest(file.path().getBytes(java.nio.charset.StandardCharsets.UTF_8)))
                        .equals(call.getArgument(1))).findFirst().orElse(null));
        doAnswer(call -> { FileRecord f = call.getArgument(0); records.put(f.id(), f); return null; }).when(repo).insert(any(), anyString());
        doAnswer(call -> { FileRecord f = call.getArgument(0); records.put(f.id(), f); return null; }).when(repo).retry(any());
        doAnswer(call -> {
            FileRecord f = call.getArgument(0); String state = call.getArgument(1);
            records.put(f.id(), new FileRecord(f.id(), f.userId(), f.path(), f.size(), f.sha256(), f.key(), state,
                    state.equals("READY") ? Instant.now() : null, f.previewKey())); return null;
        }).when(repo).state(any(), anyString());
        doAnswer(call -> {
            FileRecord f = records.get(((FileRecord) call.getArgument(0)).id());
            records.put(f.id(), new FileRecord(f.id(), f.userId(), f.path(), f.size(), f.sha256(), f.key(), f.state(), f.verifiedAt(), call.getArgument(1)));
            return null;
        }).when(repo).preview(any(), anyString());
        storage = new PrivateSpaceStorage() {
            public Upload upload(String key) { return new Upload("https://storage.test/" + key, Map.of()); }
            public void seal(String staging, String key) { objects.putIfAbsent(key, objects.get(staging).clone()); }
            public InputStream open(String key) { return new ByteArrayInputStream(objects.get(key)); }
            public String readUrl(String key) { return "https://storage.test/" + key; }
            public void putPreview(String key, byte[] jpeg) { objects.put(key, jpeg); }
        };
        service = new PrivateSpaceService(new PrivateSpaceProperties(true, owner, "", "", "", "", 32L << 30, 512L << 20),
                repo, storage, manager, new ObjectMapper().findAndRegisterModules());
    }
    PrivateSpaceService.UploadResult start(String path, byte[] bytes) {
        return service.start(owner, new PrivateSpaceService.Start(path, bytes.length, PrivateSpaceService.hex(PrivateSpaceService.digest().digest(bytes))));
    }
    FileRecord upload(String path, byte[] bytes) {
        var result = start(path, bytes);
        FileRecord file = records.get(result.id());
        objects.put(PrivateSpaceService.staging(file), bytes.clone());
        service.complete(owner, result.id());
        return records.get(result.id());
    }

    @Test void sealsAndVerifiesRawBytesAndRejectsAllOtherAccounts() {
        byte[] raw = new byte[512 * 1024 + 13]; new Random(17).nextBytes(raw);
        FileRecord file = upload("婚纱照/原片/IMG_0001.CR3", raw);
        assertEquals("READY", file.state()); assertArrayEquals(raw, objects.get(file.key()));
        // An upload link reused after completion can alter staging only.
        objects.put(PrivateSpaceService.staging(file), new byte[] { 9 });
        service.complete(owner, file.id());
        assertArrayEquals(raw, objects.get(file.key()));
        UUID stranger = UUID.randomUUID();
        for (Runnable action : List.<Runnable>of(() -> service.list(stranger), () -> service.download(stranger, file.id()),
                () -> service.complete(stranger, file.id()), () -> service.exportFiles(stranger, List.of(file.id())),
                () -> service.start(stranger, new PrivateSpaceService.Start("a.jpg", 0, "0".repeat(64))))) {
            assertEquals("MEMBER_FORBIDDEN", assertThrows(DomainException.class, action::run).code());
        }
    }
    @Test void incompleteOrChangedBytesNeverBecomeReadyAndCanBeRetriedWithoutOverwrite() {
        byte[] expected = { 0, 1, 2, 3, -1 };
        for (byte[] bad : List.of(new byte[] {0,1}, new byte[] {0,1,2,3,-2}, new byte[] {0,1,2,3,-1,0})) {
            records.clear(); objects.clear();
            var result = start("原片.CR3", expected);
            FileRecord file = records.get(result.id());
            objects.put(PrivateSpaceService.staging(file), bad);
            assertEquals("FILE_INVALID", assertThrows(DomainException.class, () -> service.complete(owner, file.id())).code());
            assertEquals("FAILED", records.get(file.id()).state()); assertTrue(service.list(owner).isEmpty());
            var retried = start("原片.CR3", expected);
            FileRecord fresh = records.get(retried.id()); assertNotEquals(file.key(), fresh.key());
            objects.put(PrivateSpaceService.staging(fresh), expected);
            service.complete(owner, fresh.id()); assertEquals("READY", records.get(fresh.id()).state());
        }
    }
    @Test void samePathIsIdempotentButDifferentContentCannotReplaceOriginal() {
        FileRecord original = upload("精修/合照.jpg", new byte[] {1,2,3});
        assertEquals("READY", start(original.path(), new byte[] {1,2,3}).state());
        assertThrows(DomainException.class, () -> start(original.path(), new byte[] {1,2,4}));
        assertArrayEquals(new byte[] {1,2,3}, objects.get(original.key()));
    }
    @Test void jpgPreviewNeverReencodesOriginalOrStripsOriginalMetadata() throws Exception {
        ByteArrayOutputStream jpeg = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(80,60, BufferedImage.TYPE_INT_RGB), "jpg", jpeg);
        byte[] plain = jpeg.toByteArray();
        byte[] exif = { 'E','x','i','f',0,0,'I','I',42,0,8,0,0,0,0,0,0,0,0,0 };
        ByteArrayOutputStream withMetadata = new ByteArrayOutputStream();
        withMetadata.write(plain, 0, 2); // SOI followed by an EXIF APP1 segment.
        withMetadata.write(new byte[] { (byte)255, (byte)225, 0, (byte)(exif.length + 2) });
        withMetadata.write(exif); withMetadata.write(plain, 2, plain.length - 2);
        byte[] bytes = withMetadata.toByteArray();
        FileRecord file = upload("精修/合照.JPG", bytes);
        assertArrayEquals(bytes, objects.get(file.key()));
        assertNotNull(file.previewKey()); assertNotEquals(file.key(), file.previewKey());
        assertNotNull(ImageIO.read(new ByteArrayInputStream(objects.get(file.previewKey()))));
    }
    @Test void exportPreservesExactPathsRawAndXmpBytesAndIncludesChecksums() throws Exception {
        byte[] raw = { 0, -1, 100, 3 }, xmp = "<?xml version=\"1.0\"?><修图参数 曝光=\"0.5\"/>\r\n".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        FileRecord a = upload("婚纱照/IMG_0001.CR3", raw), b = upload("婚纱照/IMG_0001.xmp", xmp);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        service.export(owner, List.of(a.id(), b.id()), output);
        Map<String, byte[]> entries = new HashMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(output.toByteArray()))) {
            for (var entry = zip.getNextEntry(); entry != null; entry = zip.getNextEntry()) entries.put(entry.getName(), zip.readAllBytes());
        }
        assertArrayEquals(raw, entries.get(a.path())); assertArrayEquals(xmp, entries.get(b.path()));
        byte[] manifest = entries.entrySet().stream().filter(entry -> entry.getKey().startsWith("__integrity_")).findFirst().orElseThrow().getValue();
        var doc = new ObjectMapper().readTree(manifest); assertEquals("SHA-256", doc.get("algorithm").asText());
        assertEquals(a.sha256(), doc.get("files").get(0).get("sha256").asText());
        objects.put(a.key(), new byte[] { 1 });
        assertThrows(IOException.class, () -> service.export(owner, List.of(a.id()), new ByteArrayOutputStream()));
    }
    @Test void quotaCountsPendingUploadsAndUnsafePathsAreRejected() {
        service.start(owner, new PrivateSpaceService.Start("大原片.CR3", 512L << 20, "0".repeat(64)));
        assertEquals(1, records.size());
        for (String path : List.of("../a.jpg", "/a.jpg", "a/../a.jpg", "C:\\a.jpg", "a//b.jpg", "a\nb.jpg", "a.html"))
            assertThrows(DomainException.class, () -> start(path, new byte[0]), path);
        assertThrows(DomainException.class, () -> service.start(owner, new PrivateSpaceService.Start("a.cr3", (512L << 20) + 1, "0".repeat(64))));
        PrivateSpaceService small = new PrivateSpaceService(new PrivateSpaceProperties(true, owner, "", "", "", "", 1, 512L << 20),
                repo, storage, mock(PlatformTransactionManager.class), new ObjectMapper());
        assertEquals("QUOTA_EXCEEDED", assertThrows(DomainException.class, () -> small.start(owner, new PrivateSpaceService.Start("a.jpg", 1, "0".repeat(64)))).code());
    }
}
