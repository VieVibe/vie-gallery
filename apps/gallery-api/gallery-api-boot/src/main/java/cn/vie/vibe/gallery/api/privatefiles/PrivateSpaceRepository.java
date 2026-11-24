package cn.vie.vibe.gallery.api.privatefiles;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Repository
public class PrivateSpaceRepository {
    public record FileRecord(UUID id, UUID userId, String path, long size, String sha256,
                             String key, String state, Instant verifiedAt, String previewKey) {}
    private final JdbcTemplate db;
    private static final RowMapper<FileRecord> ROW = (rs, index) -> new FileRecord(
            UUID.fromString(rs.getString("id")), UUID.fromString(rs.getString("user_id")),
            rs.getString("file_path"), rs.getLong("byte_size"), rs.getString("sha256"),
            rs.getString("object_key"), rs.getString("state"),
            rs.getTimestamp("verified_at") == null ? null : rs.getTimestamp("verified_at").toInstant(), rs.getString("preview_key"));
    public PrivateSpaceRepository(JdbcTemplate db) { this.db = db; }
    public void lockOwner(UUID id) {
        db.queryForObject("SELECT id FROM users WHERE id = UNHEX(REPLACE(?, '-', '')) FOR UPDATE", byte[].class, id.toString());
    }
    public List<FileRecord> list(UUID owner) {
        return db.query("SELECT * FROM private_space_file WHERE user_id = ? ORDER BY file_path", ROW, owner.toString());
    }
    public FileRecord byId(UUID owner, UUID id, boolean lock) {
        return db.query("SELECT * FROM private_space_file WHERE user_id = ? AND id = ?" + (lock ? " FOR UPDATE" : ""),
                ROW, owner.toString(), id.toString()).stream().findFirst().orElse(null);
    }
    public FileRecord byPath(UUID owner, String hash) {
        return db.query("SELECT * FROM private_space_file WHERE user_id = ? AND path_hash = ?", ROW,
                owner.toString(), hash).stream().findFirst().orElse(null);
    }
    public void insert(FileRecord file, String pathHash) {
        db.update("INSERT INTO private_space_file (id,user_id,file_path,path_hash,byte_size,sha256,object_key,state) VALUES (?,?,?,?,?,?,?,?)",
                file.id().toString(), file.userId().toString(), file.path(), pathHash, file.size(), file.sha256(), file.key(), file.state());
    }
    public void retry(FileRecord file) {
        db.update("UPDATE private_space_file SET object_key = ?, state = 'UPLOADING' WHERE id = ? AND user_id = ? AND state = 'FAILED'",
                file.key(), file.id().toString(), file.userId().toString());
    }
    public void state(FileRecord file, String state) {
        db.update("UPDATE private_space_file SET state = ?, verified_at = ? WHERE id = ? AND user_id = ?",
                state, state.equals("READY") ? java.sql.Timestamp.from(Instant.now()) : null, file.id().toString(), file.userId().toString());
    }
    public void preview(FileRecord file, String key) {
        db.update("UPDATE private_space_file SET preview_key = ? WHERE id = ? AND user_id = ? AND state = 'READY'",
                key, file.id().toString(), file.userId().toString());
    }
}
