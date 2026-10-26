using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Patika.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class Phase6FanoutDeferral : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "fanout_offset",
                table: "urgent_posts",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "fanout_retry_at",
                table: "urgent_posts",
                type: "timestamptz",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_urgent_posts_fanout_retry",
                table: "urgent_posts",
                column: "fanout_retry_at",
                filter: "fanout_retry_at IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "ck_urgent_posts_fanout_offset",
                table: "urgent_posts",
                sql: "fanout_offset BETWEEN 0 AND 500");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_urgent_posts_fanout_retry",
                table: "urgent_posts");

            migrationBuilder.DropCheckConstraint(
                name: "ck_urgent_posts_fanout_offset",
                table: "urgent_posts");

            migrationBuilder.DropColumn(
                name: "fanout_offset",
                table: "urgent_posts");

            migrationBuilder.DropColumn(
                name: "fanout_retry_at",
                table: "urgent_posts");
        }
    }
}
