ALTER TABLE photo_asset_variant
    DROP CHECK ck_photo_asset_variant_kind,
    ADD CONSTRAINT ck_photo_asset_variant_kind CHECK (variant_kind IN ('MEDIUM', 'HIGH', 'TEXTURE', 'PREVIEW', 'COVER'));
