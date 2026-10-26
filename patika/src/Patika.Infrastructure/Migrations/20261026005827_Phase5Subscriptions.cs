using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Patika.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class Phase5Subscriptions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "app_store_notifications");

            migrationBuilder.DropIndex(
                name: "IX_subscriptions_original_transaction_id_hash_environment",
                table: "subscriptions");

            migrationBuilder.DropColumn(
                name: "last_notification_uuid",
                table: "subscriptions");

            migrationBuilder.RenameColumn(
                name: "original_transaction_id_hash",
                table: "subscriptions",
                newName: "purchase_token_hash");

            migrationBuilder.AddColumn<bool>(
                name: "acknowledged",
                table: "subscriptions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "auto_renewing",
                table: "subscriptions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "base_plan_id",
                table: "subscriptions",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "last_event_at",
                table: "subscriptions",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<string>(
                name: "linked_purchase_token_hash",
                table: "subscriptions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "protected_purchase_token",
                table: "subscriptions",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "fake_play_purchases",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    token_hash = table.Column<string>(type: "text", nullable: false),
                    package_name = table.Column<string>(type: "text", nullable: false),
                    response_json = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_fake_play_purchases", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "play_notifications",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    message_id = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    payload_hash = table.Column<string>(type: "text", nullable: false),
                    purchase_token_hash = table.Column<string>(type: "text", nullable: true),
                    event_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    received_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    processed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    attempts = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_play_notifications", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_subscriptions_purchase_token_hash",
                table: "subscriptions",
                column: "purchase_token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_fake_play_purchases_token_hash",
                table: "fake_play_purchases",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_play_notifications_message_id",
                table: "play_notifications",
                column: "message_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_play_notifications_processed_at_received_at",
                table: "play_notifications",
                columns: new[] { "processed_at", "received_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "fake_play_purchases");

            migrationBuilder.DropTable(
                name: "play_notifications");

            migrationBuilder.DropIndex(
                name: "IX_subscriptions_purchase_token_hash",
                table: "subscriptions");

            migrationBuilder.DropColumn(
                name: "acknowledged",
                table: "subscriptions");

            migrationBuilder.DropColumn(
                name: "auto_renewing",
                table: "subscriptions");

            migrationBuilder.DropColumn(
                name: "base_plan_id",
                table: "subscriptions");

            migrationBuilder.DropColumn(
                name: "last_event_at",
                table: "subscriptions");

            migrationBuilder.DropColumn(
                name: "linked_purchase_token_hash",
                table: "subscriptions");

            migrationBuilder.DropColumn(
                name: "protected_purchase_token",
                table: "subscriptions");

            migrationBuilder.RenameColumn(
                name: "purchase_token_hash",
                table: "subscriptions",
                newName: "original_transaction_id_hash");

            migrationBuilder.AddColumn<Guid>(
                name: "last_notification_uuid",
                table: "subscriptions",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "app_store_notifications",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    notification_uuid = table.Column<Guid>(type: "uuid", nullable: false),
                    processed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    received_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    subtype = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_app_store_notifications", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_subscriptions_original_transaction_id_hash_environment",
                table: "subscriptions",
                columns: new[] { "original_transaction_id_hash", "environment" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_app_store_notifications_notification_uuid",
                table: "app_store_notifications",
                column: "notification_uuid",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_app_store_notifications_processed_at_received_at",
                table: "app_store_notifications",
                columns: new[] { "processed_at", "received_at" });
        }
    }
}
