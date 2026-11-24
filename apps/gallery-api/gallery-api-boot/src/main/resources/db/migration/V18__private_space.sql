-- Temporary personal archive. Originals never enter the gallery image pipeline.
CREATE TABLE private_space_file (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    file_path VARCHAR(1024) COLLATE utf8mb4_bin NOT NULL,
    path_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    byte_size BIGINT NOT NULL,
    sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    object_key VARCHAR(240) NOT NULL,
    preview_key VARCHAR(240) NULL,
    state VARCHAR(16) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    verified_at TIMESTAMP(6) NULL,
    UNIQUE KEY uk_private_space_path (user_id, path_hash),
    KEY idx_private_space_owner (user_id, state),
    CONSTRAINT ck_private_space_size CHECK (byte_size >= 0),
    CONSTRAINT ck_private_space_state CHECK (state IN ('UPLOADING', 'READY', 'FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
