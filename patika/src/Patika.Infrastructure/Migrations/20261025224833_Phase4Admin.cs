using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Patika.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class Phase4Admin : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "suspended_until",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "totp_enabled_at",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "totp_failed_attempts",
                table: "users",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "totp_failure_window_at",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "totp_last_step",
                table: "users",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "totp_locked_until",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "auth_time",
                table: "refresh_tokens",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "mfa",
                table: "refresh_tokens",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "admin_access_tokens",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    session_id = table.Column<Guid>(type: "uuid", nullable: false),
                    session_version = table.Column<int>(type: "integer", nullable: false),
                    purpose = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    token_hash = table.Column<byte[]>(type: "bytea", nullable: false),
                    reason = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    auth_method = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    auth_time = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    used_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_admin_access_tokens", x => x.id);
                    table.ForeignKey(
                        name: "FK_admin_access_tokens_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "care_place_imports",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    file_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    row_count = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_care_place_imports", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "totp_recovery_codes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    code_hash = table.Column<byte[]>(type: "bytea", nullable: false),
                    used_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_totp_recovery_codes", x => x.id);
                    table.ForeignKey(
                        name: "FK_totp_recovery_codes_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_urgent_posts_created_at_id",
                table: "urgent_posts",
                columns: new[] { "created_at", "id" });

            migrationBuilder.CreateIndex(
                name: "IX_reports_state_created_at_id",
                table: "reports",
                columns: new[] { "state", "created_at", "id" });

            migrationBuilder.CreateIndex(
                name: "IX_audit_logs_created_at_id",
                table: "audit_logs",
                columns: new[] { "created_at", "id" });

            migrationBuilder.CreateIndex(
                name: "IX_animal_photos_moderation_state_created_at_id",
                table: "animal_photos",
                columns: new[] { "moderation_state", "created_at", "id" });

            migrationBuilder.CreateIndex(
                name: "IX_adoption_posts_state_created_at_id",
                table: "adoption_posts",
                columns: new[] { "state", "created_at", "id" });

            migrationBuilder.CreateIndex(
                name: "IX_admin_access_tokens_expires_at",
                table: "admin_access_tokens",
                column: "expires_at");

            migrationBuilder.CreateIndex(
                name: "IX_admin_access_tokens_token_hash",
                table: "admin_access_tokens",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_admin_access_tokens_user_id",
                table: "admin_access_tokens",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_care_place_imports_file_hash",
                table: "care_place_imports",
                column: "file_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_totp_recovery_codes_user_id",
                table: "totp_recovery_codes",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "admin_access_tokens");

            migrationBuilder.DropTable(
                name: "care_place_imports");

            migrationBuilder.DropTable(
                name: "totp_recovery_codes");

            migrationBuilder.DropIndex(
                name: "IX_urgent_posts_created_at_id",
                table: "urgent_posts");

            migrationBuilder.DropIndex(
                name: "IX_reports_state_created_at_id",
                table: "reports");

            migrationBuilder.DropIndex(
                name: "IX_audit_logs_created_at_id",
                table: "audit_logs");

            migrationBuilder.DropIndex(
                name: "IX_animal_photos_moderation_state_created_at_id",
                table: "animal_photos");

            migrationBuilder.DropIndex(
                name: "IX_adoption_posts_state_created_at_id",
                table: "adoption_posts");

            migrationBuilder.DropColumn(
                name: "suspended_until",
                table: "users");

            migrationBuilder.DropColumn(
                name: "totp_enabled_at",
                table: "users");

            migrationBuilder.DropColumn(
                name: "totp_failed_attempts",
                table: "users");

            migrationBuilder.DropColumn(
                name: "totp_failure_window_at",
                table: "users");

            migrationBuilder.DropColumn(
                name: "totp_last_step",
                table: "users");

            migrationBuilder.DropColumn(
                name: "totp_locked_until",
                table: "users");

            migrationBuilder.DropColumn(
                name: "auth_time",
                table: "refresh_tokens");

            migrationBuilder.DropColumn(
                name: "mfa",
                table: "refresh_tokens");
        }
    }
}
