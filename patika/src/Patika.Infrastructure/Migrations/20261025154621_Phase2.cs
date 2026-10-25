using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NetTopologySuite.Geometries;

#nullable disable

namespace Patika.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class Phase2 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_users_urgent_radius",
                table: "users");

            migrationBuilder.AddColumn<int>(
                name: "session_version",
                table: "users",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<Point>(
                name: "urgent_home",
                table: "users",
                type: "geography(Point,4326)",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "fanout_at",
                table: "urgent_posts",
                type: "timestamptz",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "installation_id",
                table: "device_tokens",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.Sql("UPDATE urgent_posts SET fanout_at = created_at WHERE fanout_at IS NULL;");
            migrationBuilder.Sql("UPDATE device_tokens SET installation_id = gen_random_uuid();");
            migrationBuilder.Sql("UPDATE users SET urgent_radius_m = LEAST(GREATEST(urgent_radius_m, 500), 2000);");

            migrationBuilder.CreateTable(
                name: "push_daily_counters",
                columns: table => new
                {
                    day = table.Column<DateOnly>(type: "date", nullable: false),
                    channel = table.Column<string>(type: "text", nullable: false),
                    count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_push_daily_counters", x => new { x.day, x.channel });
                });

            migrationBuilder.CreateTable(
                name: "uploads",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "text", nullable: false),
                    key = table.Column<string>(type: "text", nullable: false),
                    content_type = table.Column<string>(type: "text", nullable: false),
                    content_length = table.Column<long>(type: "bigint", nullable: false),
                    state = table.Column<string>(type: "text", nullable: false),
                    failure_code = table.Column<string>(type: "text", nullable: true),
                    processed_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_uploads", x => x.id);
                    table.UniqueConstraint("uploads_key_key", x => x.key);
                    table.CheckConstraint("uploads_content_length_check", "content_length BETWEEN 1 AND 5242880");
                    table.ForeignKey(
                        name: "FK_uploads_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_users_urgent_home",
                table: "users",
                column: "urgent_home",
                filter: "urgent_opt_in")
                .Annotation("Npgsql:IndexMethod", "gist");

            migrationBuilder.AddCheckConstraint(
                name: "ck_users_urgent_radius",
                table: "users",
                sql: "urgent_radius_m BETWEEN 500 AND 2000");

            migrationBuilder.CreateIndex(
                name: "ix_urgent_posts_fanout_pending",
                table: "urgent_posts",
                column: "created_at",
                filter: "fanout_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_device_tokens_installation_id",
                table: "device_tokens",
                column: "installation_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_uploads_user_id_created_at",
                table: "uploads",
                columns: new[] { "user_id", "created_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "push_daily_counters");

            migrationBuilder.DropTable(
                name: "uploads");

            migrationBuilder.DropIndex(
                name: "ix_users_urgent_home",
                table: "users");

            migrationBuilder.DropCheckConstraint(
                name: "ck_users_urgent_radius",
                table: "users");

            migrationBuilder.DropIndex(
                name: "ix_urgent_posts_fanout_pending",
                table: "urgent_posts");

            migrationBuilder.DropIndex(
                name: "IX_device_tokens_installation_id",
                table: "device_tokens");

            migrationBuilder.DropColumn(
                name: "session_version",
                table: "users");

            migrationBuilder.DropColumn(
                name: "urgent_home",
                table: "users");

            migrationBuilder.DropColumn(
                name: "fanout_at",
                table: "urgent_posts");

            migrationBuilder.DropColumn(
                name: "installation_id",
                table: "device_tokens");

            migrationBuilder.AddCheckConstraint(
                name: "ck_users_urgent_radius",
                table: "users",
                sql: "urgent_radius_m BETWEEN 0 AND 5000");
        }
    }
}
