package cn.vie.vibe.gallery.api.privatefiles;

import cn.vie.vibe.gallery.domain.DomainException;
import cn.vie.vibe.gallery.api.privatefiles.PrivateSpaceRepository.FileRecord;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.imageio.ImageIO;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.*;
import java.util.zip.*;

@Service
@ConditionalOnProperty(name = "gallery.private-space.enabled", havingValue = "true")
public class PrivateSpaceService {
    public record Start(String path, long size, String sha256) {}
    public record UploadResult(UUID id, String state, String uploadUrl, Map<String, String> headers) {}
    public record FileView(UUID id, String path, long size, String sha256, Instant verifiedAt, boolean previewAvailable) {
        static FileView from(FileRecord f) { return new FileView(f.id(), f.path(), f.size(), f.sha256(), f.verifiedAt(), f.previewKey() != null); }
    }
    private final PrivateSpaceProperties properties;
    private final PrivateSpaceRepository files;
    private final PrivateSpaceStorage storage;
    private final TransactionTemplate transactions;
    private final ObjectMapper json;

    public PrivateSpaceService(PrivateSpaceProperties properties, PrivateSpaceRepository files,
                               PrivateSpaceStorage storage, PlatformTransactionManager manager, ObjectMapper json) {
        this.properties = properties; this.files = files; this.storage = storage;
        this.transactions = new TransactionTemplate(manager); this.json = json;
    }

    public void authorize(UUID owner) {
        if (!properties.allows(owner)) throw new DomainException("MEMBER_FORBIDDEN", "无权访问私人空间");
    }

    public List<FileView> list(UUID owner) {
        authorize(owner);
        return files.list(owner).stream().filter(f -> f.state().equals("READY")).map(FileView::from).toList();
    }

    public UploadResult start(UUID owner, Start request) {
        authorize(owner);
        validatePath(request.path());
        if (request.size() < 0 || request.size() > properties.maxFileBytes())
            throw new DomainException("FILE_TOO_LARGE", "文件超过私人空间的单文件限制");
        if (request.sha256() == null || !request.sha256().matches("[a-f0-9]{64}"))
            throw new DomainException("VALIDATION_FAILED", "需要原文件的 SHA-256 校验值");
        String pathHash = hex(digest().digest(request.path().getBytes(StandardCharsets.UTF_8)));
        FileRecord file = transactions.execute(status -> {
            files.lockOwner(owner); // Serializes reservations across requests and server instances.
            FileRecord old = files.byPath(owner, pathHash);
            if (old != null && (!old.path().equals(request.path()) || old.size() != request.size() || !old.sha256().equals(request.sha256())))
                throw new DomainException("RESOURCE_CONFLICT", "已有同名文件，内容不同；请更换目录，原文件不会被覆盖");
            if (old != null && !old.state().equals("FAILED")) return old;
            List<FileRecord> records = files.list(owner);
            long reserved = records.stream().filter(f -> !f.state().equals("FAILED")).mapToLong(FileRecord::size).sum();
            if (request.size() > properties.quotaBytes() - reserved || (old == null && records.size() >= 20000))
                throw new DomainException("QUOTA_EXCEEDED", "私人空间容量或文件数量已达上限");
            UUID id = old == null ? UUID.randomUUID() : old.id();
            FileRecord next = new FileRecord(id, owner, request.path(), request.size(), request.sha256(),
                    "originals/" + owner + "/" + UUID.randomUUID(), "UPLOADING", null, null);
            if (old == null) files.insert(next, pathHash); else files.retry(next);
            return next;
        });
        if (file.state().equals("READY")) return new UploadResult(file.id(), "READY", null, Map.of());
        PrivateSpaceStorage.Upload upload = storage.upload(staging(file));
        return new UploadResult(file.id(), "UPLOADING", upload.url(), upload.headers());
    }

    public FileView complete(UUID owner, UUID id) {
        authorize(owner);
        FileRecord checked = transactions.execute(status -> {
            FileRecord file = required(owner, id, true);
            if (file.state().equals("READY")) return file;
            if (file.state().equals("FAILED")) throw new DomainException("FILE_INVALID", "文件校验失败，请重新选择原文件上传");
            // A signed PUT can still be reused until it expires. Copy to a server-only key
            // before verifying; later staging writes cannot change an accepted original.
            // Each retry uses a fresh key; no accepted original is ever replaced or deleted.
            try { storage.seal(staging(file), file.key()); }
            catch (com.aliyun.oss.OSSException e) {
                if (!"FileAlreadyExists".equals(e.getErrorCode())) throw e;
                // Previous attempt may have finished the copy before the response was lost.
            }
            try (InputStream input = storage.open(file.key())) {
                if (!matches(input, file, null)) {
                    files.state(file, "FAILED");
                    return null; // Commit failure state; throw only after the transaction ends.
                }
            } catch (IOException e) { throw new UncheckedIOException(e); }
            files.state(file, "READY");
            return new FileRecord(file.id(), owner, file.path(), file.size(), file.sha256(), file.key(), "READY", Instant.now(), null);
        });
        if (checked == null) throw new DomainException("FILE_INVALID", "云端文件与本地原件不一致，未收入空间，请重试");
        if (checked.previewKey() == null) makePreview(checked);
        return FileView.from(required(owner, id, false));
    }

    public FileRecord required(UUID owner, UUID id, boolean lock) {
        authorize(owner);
        FileRecord file = files.byId(owner, id, lock);
        if (file == null) throw new DomainException("RESOURCE_NOT_FOUND", "文件不存在");
        return file;
    }
    public FileRecord ready(UUID owner, UUID id) {
        FileRecord file = required(owner, id, false);
        if (!file.state().equals("READY")) throw new DomainException("FILE_INVALID", "文件尚未通过完整性校验");
        return file;
    }
    public String download(UUID owner, UUID id) { return storage.readUrl(ready(owner, id).key()); }
    public byte[] preview(UUID owner, UUID id) throws IOException {
        FileRecord file = ready(owner, id);
        if (file.previewKey() == null) throw new DomainException("RESOURCE_NOT_FOUND", "这个文件没有预览图");
        try (InputStream in = storage.open(file.previewKey())) { return in.readAllBytes(); }
    }
    public List<FileRecord> exportFiles(UUID owner, List<UUID> ids) {
        authorize(owner);
        if (ids == null || ids.isEmpty() || ids.size() > 20000)
            throw new DomainException("VALIDATION_FAILED", "请选择要下载的文件");
        return ids.stream().distinct().map(id -> ready(owner, id)).toList();
    }
    public void export(UUID owner, List<UUID> ids, OutputStream output) throws IOException {
        List<FileRecord> records = exportFiles(owner, ids);
        // Do not close/finish a failed ZIP: a checksum mismatch must leave an invalid
        // archive instead of a deceptively successful download with damaged originals.
        ArchiveStream zip = new ArchiveStream(output);
        try {
            zip.setLevel(Deflater.NO_COMPRESSION); // ZIP is lossless, including CR3 and XMP.
            for (FileRecord file : records) {
                zip.putNextEntry(new ZipEntry(file.path()));
                try (InputStream in = storage.open(file.key())) {
                    if (!matches(in, file, zip)) throw new IOException("Original integrity verification failed; export aborted");
                }
                zip.closeEntry();
            }
            String manifestPath;
            Set<String> paths = new HashSet<>(records.stream().map(FileRecord::path).toList());
            do { manifestPath = "__integrity_" + UUID.randomUUID() + ".json"; } while (paths.contains(manifestPath));
            zip.putNextEntry(new ZipEntry(manifestPath));
            zip.write(json.writeValueAsBytes(Map.of("algorithm", "SHA-256", "files", records.stream().map(FileView::from).toList())));
            zip.closeEntry();
            zip.finish();
            zip.flush();
        } finally { zip.release(); }
    }

    private static final class ArchiveStream extends ZipOutputStream {
        ArchiveStream(OutputStream output) { super(output, StandardCharsets.UTF_8); }
        void release() { def.end(); } // Free native resources without finishing a failed ZIP.
    }

    static boolean matches(InputStream input, FileRecord file, OutputStream copy) throws IOException {
        MessageDigest sha = digest();
        byte[] buffer = new byte[128 * 1024];
        long size = 0;
        for (int n; (n = input.read(buffer)) != -1;) {
            size += n;
            if (size > file.size()) return false;
            sha.update(buffer, 0, n);
            if (copy != null) copy.write(buffer, 0, n);
        }
        return size == file.size() && hex(sha.digest()).equals(file.sha256());
    }
    public static void validatePath(String path) {
        if (path == null || path.isBlank() || path.length() > 1024 || path.startsWith("/")
                || path.contains("\\") || path.contains(":") || path.chars().anyMatch(c -> c < 32 || c == 127))
            throw new DomainException("VALIDATION_FAILED", "请使用有效的相对文件路径");
        for (String part : path.split("/", -1)) {
            if (part.isBlank() || part.equals(".") || part.equals(".."))
                throw new DomainException("VALIDATION_FAILED", "文件路径不能包含空目录或上级目录");
        }
        String name = path.substring(path.lastIndexOf('/') + 1).toLowerCase(Locale.ROOT);
        if (!name.matches(".+\\.(cr3|xmp|jpg|jpeg|png|tif|tiff|psd)"))
            throw new DomainException("FILE_TYPE_UNSUPPORTED", "支持 CR3、XMP、JPG、PNG、TIFF 和 PSD 原文件");
    }
    private void makePreview(FileRecord file) {
        if (!file.path().toLowerCase(Locale.ROOT).matches(".*\\.(jpg|jpeg|png)$")) return;
        try (InputStream in = storage.open(file.key()); var imageInput = ImageIO.createImageInputStream(in)) {
            var readers = ImageIO.getImageReaders(imageInput);
            if (!readers.hasNext()) return;
            var reader = readers.next();
            try {
                reader.setInput(imageInput, true, true);
                int width = reader.getWidth(0), height = reader.getHeight(0);
                if (width > 100000 || height > 100000 || (long) width * height > 200000000L) return;
                var param = reader.getDefaultReadParam();
                int sample = Math.max(1, (int) Math.ceil(Math.max(width, height) / 1280.0));
                param.setSourceSubsampling(sample, sample, 0, 0);
                var image = reader.read(0, param);
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                net.coobird.thumbnailator.Thumbnails.of(image).size(1280, 1280).outputFormat("jpg").toOutputStream(bytes);
                String key = "previews/" + file.userId() + "/" + file.id() + ".jpg";
                storage.putPreview(key, bytes.toByteArray());
                files.preview(file, key);
            } finally { reader.dispose(); }
        } catch (Exception ignored) {
            // A failed optional preview must never modify or reject a verified original.
        }
    }
    static String staging(FileRecord file) { return "staging/" + file.key().substring("originals/".length()); }
    static MessageDigest digest() {
        try { return MessageDigest.getInstance("SHA-256"); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    static String hex(byte[] bytes) { return HexFormat.of().formatHex(bytes); }
}
