using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Patika.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class Phase3Api : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_email_tokens_user_id",
                table: "email_tokens");

            migrationBuilder.AddColumn<string>(
                name: "district",
                table: "stations",
                type: "character varying(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "failed_attempts",
                table: "email_tokens",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "district",
                table: "animals",
                type: "character varying(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "idempotency_keys",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    key = table.Column<Guid>(type: "uuid", nullable: false),
                    request_hash = table.Column<byte[]>(type: "bytea", nullable: false),
                    status_code = table.Column<int>(type: "integer", nullable: false),
                    content_type = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    location = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    response_body = table.Column<byte[]>(type: "bytea", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_idempotency_keys", x => x.id);
                    table.CheckConstraint("ck_idempotency_keys_body_length", "octet_length(response_body) <= 65536");
                    table.CheckConstraint("ck_idempotency_keys_hash_length", "octet_length(request_hash) = 32");
                    table.ForeignKey(
                        name: "FK_idempotency_keys_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            // Older unused codes of the same user and purpose would break the unique index; keep the newest live one.
            migrationBuilder.Sql("""
                UPDATE email_tokens AS t
                SET used_at = now()
                WHERE t.used_at IS NULL
                  AND EXISTS (
                      SELECT 1 FROM email_tokens AS n
                      WHERE n.user_id = t.user_id AND n.purpose = t.purpose AND n.used_at IS NULL
                        AND (n.created_at, n.id) > (t.created_at, t.id));
                """);

            migrationBuilder.CreateIndex(
                name: "ux_email_tokens_live_code",
                table: "email_tokens",
                columns: new[] { "user_id", "purpose" },
                unique: true,
                filter: "used_at IS NULL");

            migrationBuilder.AddCheckConstraint(
                name: "ck_email_tokens_failed_attempts",
                table: "email_tokens",
                sql: "failed_attempts BETWEEN 0 AND 5");

            migrationBuilder.CreateIndex(
                name: "IX_idempotency_keys_created_at",
                table: "idempotency_keys",
                column: "created_at");

            migrationBuilder.CreateIndex(
                name: "IX_idempotency_keys_user_id_key",
                table: "idempotency_keys",
                columns: new[] { "user_id", "key" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "idempotency_keys");

            migrationBuilder.DropIndex(
                name: "ux_email_tokens_live_code",
                table: "email_tokens");

            migrationBuilder.DropCheckConstraint(
                name: "ck_email_tokens_failed_attempts",
                table: "email_tokens");

            migrationBuilder.DropColumn(
                name: "district",
                table: "stations");

            migrationBuilder.DropColumn(
                name: "failed_attempts",
                table: "email_tokens");

            migrationBuilder.DropColumn(
                name: "district",
                table: "animals");

            migrationBuilder.CreateIndex(
                name: "IX_email_tokens_user_id",
                table: "email_tokens",
                column: "user_id");
        }
    }
}
