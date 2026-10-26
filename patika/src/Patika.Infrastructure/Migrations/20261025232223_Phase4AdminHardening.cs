using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Patika.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class Phase4AdminHardening : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "action",
                table: "admin_access_tokens",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "target_id",
                table: "admin_access_tokens",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "action",
                table: "admin_access_tokens");

            migrationBuilder.DropColumn(
                name: "target_id",
                table: "admin_access_tokens");
        }
    }
}
