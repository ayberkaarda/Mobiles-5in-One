<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One row per prepaid unit ("askı"). The reserve and redeem engines move a unit through
 * AVAILABLE -> RESERVED -> REDEEMED (or EXPIRED); the database enforces the state shape,
 * a single live code per shop and that REDEEMED is final.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('hooks', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('donation_id')->constrained('donations')->restrictOnDelete();
            $table->foreignUuid('shop_id')->constrained('shops')->restrictOnDelete();
            $table->foreignUuid('item_id')->constrained('items')->restrictOnDelete();
            $table->string('status', 16)->default('AVAILABLE');
            // Removing an anonymous device (DELETE anon/me) clears the link immediately.
            $table->string('anon_id', 64)->nullable();
            // HMAC-SHA256(code, HOOK_CODE_PEPPER) as lowercase hex; the code itself is never stored.
            $table->char('code_hash', 64)->nullable();
            $table->timestampTz('reserved_at')->nullable();
            $table->timestampTz('expires_at')->nullable();
            $table->timestampTz('redeemed_at')->nullable();
            $table->foreignUuid('redeemed_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->foreign('anon_id')->references('anon_id')->on('anon_devices')->nullOnDelete();
            $table->index(['donation_id', 'status']);
        });

        DB::statement("ALTER TABLE hooks ADD CONSTRAINT hooks_status_check CHECK (status IN ('AVAILABLE', 'RESERVED', 'REDEEMED', 'EXPIRED'))");
        DB::statement("ALTER TABLE hooks ADD CONSTRAINT hooks_code_hash_format_check CHECK (code_hash IS NULL OR code_hash ~ '^[0-9a-f]{64}$')");
        DB::statement(<<<'SQL'
            ALTER TABLE hooks ADD CONSTRAINT hooks_state_shape_check CHECK (
                (status = 'AVAILABLE' AND anon_id IS NULL AND code_hash IS NULL AND reserved_at IS NULL
                    AND expires_at IS NULL AND redeemed_at IS NULL AND redeemed_by_user_id IS NULL)
                OR (status = 'RESERVED' AND code_hash IS NOT NULL AND reserved_at IS NOT NULL
                    AND expires_at IS NOT NULL AND expires_at > reserved_at AND redeemed_at IS NULL)
                OR (status = 'REDEEMED' AND code_hash IS NOT NULL AND redeemed_at IS NOT NULL)
                OR (status = 'EXPIRED' AND redeemed_at IS NULL)
            )
            SQL);

        // A live or used code identifies exactly one unit within a shop. This is also the
        // lookup index of the redeem query (shop + code hash), and it rejects a second
        // REDEEMED row for the same code at the same shop.
        DB::statement("CREATE UNIQUE INDEX hooks_shop_code_hash_unique ON hooks (shop_id, code_hash) WHERE status IN ('RESERVED', 'REDEEMED')");
        // Reserve: oldest AVAILABLE unit of an item at a shop, and available counts per item.
        DB::statement("CREATE INDEX hooks_available_pick_index ON hooks (shop_id, item_id, created_at) WHERE status = 'AVAILABLE'");
        // Expiry job: reservations past their deadline.
        DB::statement("CREATE INDEX hooks_reserved_expiry_index ON hooks (expires_at) WHERE status = 'RESERVED'");
        // Redemptions of a shop per day.
        DB::statement("CREATE INDEX hooks_redeemed_day_index ON hooks (shop_id, redeemed_at) WHERE status = 'REDEEMED'");
        // Daily caps per anonymous device.
        DB::statement('CREATE INDEX hooks_anon_reserved_index ON hooks (anon_id, reserved_at) WHERE anon_id IS NOT NULL');

        // REDEEMED is final: status, code, redemption time and ownership columns can no longer
        // change. Only anonymising updates (anon_id / redeemed_by_user_id set to NULL by the
        // foreign key actions) remain possible.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION hooks_redeemed_is_final() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF OLD.status = 'REDEEMED' AND (
                    NEW.status IS DISTINCT FROM OLD.status
                    OR NEW.redeemed_at IS DISTINCT FROM OLD.redeemed_at
                    OR NEW.code_hash IS DISTINCT FROM OLD.code_hash
                    OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
                    OR NEW.item_id IS DISTINCT FROM OLD.item_id
                    OR NEW.donation_id IS DISTINCT FROM OLD.donation_id
                    OR (NEW.anon_id IS NOT NULL AND NEW.anon_id IS DISTINCT FROM OLD.anon_id)
                    OR (NEW.redeemed_by_user_id IS NOT NULL AND NEW.redeemed_by_user_id IS DISTINCT FROM OLD.redeemed_by_user_id)
                ) THEN
                    RAISE EXCEPTION 'hook is already redeemed' USING ERRCODE = 'check_violation';
                END IF;
                RETURN NEW;
            END;
            $$;

            CREATE TRIGGER hooks_redeemed_is_final
                BEFORE UPDATE ON hooks
                FOR EACH ROW EXECUTE FUNCTION hooks_redeemed_is_final();
            SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('hooks');
        DB::unprepared('DROP FUNCTION IF EXISTS hooks_redeemed_is_final()');
    }
};
