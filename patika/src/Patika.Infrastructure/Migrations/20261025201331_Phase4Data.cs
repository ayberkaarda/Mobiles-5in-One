using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Patika.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class Phase4Data : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "hidden_at",
                table: "urgent_posts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "hidden_reason",
                table: "urgent_posts",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "district_id",
                table: "stations",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "district",
                table: "care_places",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "district_id",
                table: "care_places",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "slug",
                table: "care_places",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "website",
                table: "care_places",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: true);

            migrationBuilder.AddColumn<short>(
                name: "birth_year",
                table: "animals",
                type: "smallint",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "district_id",
                table: "animals",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "adopted_at",
                table: "adoption_posts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "closed_reason",
                table: "adoption_posts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "district_id",
                table: "adoption_posts",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "slug",
                table: "adoption_posts",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "moderation_decisions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    target_type = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    target_id = table.Column<Guid>(type: "uuid", nullable: false),
                    decision = table.Column<string>(type: "text", nullable: false),
                    reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    reviewer_id = table.Column<Guid>(type: "uuid", nullable: false),
                    decided_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_moderation_decisions", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "provinces",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    slug = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_provinces", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "districts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    province_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    slug = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_districts", x => x.id);
                    table.ForeignKey(
                        name: "FK_districts_provinces_province_id",
                        column: x => x.province_id,
                        principalTable: "provinces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            // pg_temp.patika_slug mirrors Patika.Domain.Slug.From; it lives only for this migration's session.
            migrationBuilder.Sql("""
                CREATE FUNCTION pg_temp.patika_slug(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
                    SELECT coalesce(nullif(rtrim(left(trim(both '-' from regexp_replace(
                        translate(normalize(coalesce(value, ''), NFC),
                            'ABCDEFGHIJKLMNOPQRSTUVWXYZıİşŞğĞüÜöÖçÇâÂîÎûÛ', 'abcdefghijklmnopqrstuvwxyziissgguuooccaaiiuu'),
                        '[^a-z0-9]+', '-', 'g')), 80), '-'), ''), 'x');
                $$;
                INSERT INTO provinces (id, name, slug, created_at, updated_at)
                VALUES ('34000000-0000-0000-0000-000000000000', 'İstanbul', 'istanbul', '2026-10-25T00:00:00Z', '2026-10-25T00:00:00Z');
                """);
            string[] names =
            [
                "Adalar", "Arnavutköy", "Ataşehir", "Avcılar", "Bağcılar", "Bahçelievler", "Bakırköy", "Başakşehir",
                "Bayrampaşa", "Beşiktaş", "Beykoz", "Beylikdüzü", "Beyoğlu", "Büyükçekmece", "Çatalca", "Çekmeköy",
                "Esenler", "Esenyurt", "Eyüpsultan", "Fatih", "Gaziosmanpaşa", "Güngören", "Kadıköy", "Kağıthane",
                "Kartal", "Küçükçekmece", "Maltepe", "Pendik", "Sancaktepe", "Sarıyer", "Silivri", "Sultanbeyli",
                "Sultangazi", "Şile", "Şişli", "Tuzla", "Ümraniye", "Üsküdar", "Zeytinburnu"
            ];
            string[] slugs = ["adalar", "arnavutkoy", "atasehir", "avcilar", "bagcilar", "bahcelievler", "bakirkoy", "basaksehir", "bayrampasa", "besiktas", "beykoz", "beylikduzu", "beyoglu", "buyukcekmece", "catalca", "cekmekoy", "esenler", "esenyurt", "eyupsultan", "fatih", "gaziosmanpasa", "gungoren", "kadikoy", "kagithane", "kartal", "kucukcekmece", "maltepe", "pendik", "sancaktepe", "sariyer", "silivri", "sultanbeyli", "sultangazi", "sile", "sisli", "tuzla", "umraniye", "uskudar", "zeytinburnu"];
            for (var index = 0; index < names.Length; index++)
            {
                var id = Guid.Parse($"34000000-0000-0000-0000-{index + 1:000000000000}");
                var at = new DateTimeOffset(2026, 10, 25, 0, 0, 0, TimeSpan.Zero);
                migrationBuilder.InsertData("districts",
                    new[] { "id", "province_id", "name", "slug", "created_at", "updated_at" },
                    new object[] { id, Guid.Parse("34000000-0000-0000-0000-000000000000"), names[index], slugs[index], at, at });
            }
            foreach (var table in new[] { "stations", "animals", "adoption_posts", "care_places" })
            {
                migrationBuilder.Sql($"UPDATE {table} AS p SET district_id = d.id FROM districts AS d WHERE pg_temp.patika_slug(p.district) = d.slug;");
            }
            migrationBuilder.Sql("""
                DO $$
                DECLARE item record; basis text; candidate text; suffix integer;
                BEGIN
                    FOR item IN SELECT p.id, a.name, a.species, d.slug AS district FROM adoption_posts p JOIN animals a ON a.id = p.animal_id
                        LEFT JOIN districts d ON d.id = p.district_id ORDER BY p.id LOOP
                        basis := pg_temp.patika_slug(coalesce(item.name, item.species) || '-' || coalesce(item.district, '')) || '-' || left(replace(item.id::text, '-', ''), 6);
                        candidate := basis; suffix := 2;
                        WHILE EXISTS (SELECT 1 FROM adoption_posts WHERE slug = candidate) LOOP
                            candidate := basis || '-' || suffix; suffix := suffix + 1;
                        END LOOP;
                        UPDATE adoption_posts SET slug = candidate WHERE id = item.id;
                    END LOOP;
                    FOR item IN SELECT c.id, c.name, d.slug AS district FROM care_places c LEFT JOIN districts d ON d.id = c.district_id ORDER BY c.id LOOP
                        basis := pg_temp.patika_slug(item.name || '-' || coalesce(item.district, ''));
                        candidate := basis; suffix := 2;
                        WHILE EXISTS (SELECT 1 FROM care_places WHERE slug = candidate) LOOP
                            candidate := basis || '-' || suffix; suffix := suffix + 1;
                        END LOOP;
                        UPDATE care_places SET slug = candidate WHERE id = item.id;
                    END LOOP;
                END $$;
                DROP FUNCTION pg_temp.patika_slug(text);
                ALTER TABLE adoption_posts ALTER COLUMN slug DROP DEFAULT;
                ALTER TABLE care_places ALTER COLUMN slug DROP DEFAULT;
                """);
            migrationBuilder.CreateIndex(
                name: "IX_stations_district_id",
                table: "stations",
                column: "district_id");

            migrationBuilder.CreateIndex(
                name: "IX_care_places_district_id",
                table: "care_places",
                column: "district_id");

            migrationBuilder.CreateIndex(
                name: "IX_care_places_slug",
                table: "care_places",
                column: "slug",
                unique: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_care_places_website",
                table: "care_places",
                sql: "website IS NULL OR website ~ '^https://[^/[:space:]]+'");

            migrationBuilder.CreateIndex(
                name: "IX_animals_district_id",
                table: "animals",
                column: "district_id");

            migrationBuilder.CreateIndex(
                name: "IX_adoption_posts_district_id",
                table: "adoption_posts",
                column: "district_id");

            migrationBuilder.CreateIndex(
                name: "IX_adoption_posts_slug",
                table: "adoption_posts",
                column: "slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_districts_province_id_slug",
                table: "districts",
                columns: new[] { "province_id", "slug" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_moderation_decisions_target_type_target_id_decided_at",
                table: "moderation_decisions",
                columns: new[] { "target_type", "target_id", "decided_at" });

            migrationBuilder.CreateIndex(
                name: "IX_provinces_slug",
                table: "provinces",
                column: "slug",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_adoption_posts_districts_district_id",
                table: "adoption_posts",
                column: "district_id",
                principalTable: "districts",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_animals_districts_district_id",
                table: "animals",
                column: "district_id",
                principalTable: "districts",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_care_places_districts_district_id",
                table: "care_places",
                column: "district_id",
                principalTable: "districts",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_stations_districts_district_id",
                table: "stations",
                column: "district_id",
                principalTable: "districts",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_adoption_posts_districts_district_id",
                table: "adoption_posts");

            migrationBuilder.DropForeignKey(
                name: "FK_animals_districts_district_id",
                table: "animals");

            migrationBuilder.DropForeignKey(
                name: "FK_care_places_districts_district_id",
                table: "care_places");

            migrationBuilder.DropForeignKey(
                name: "FK_stations_districts_district_id",
                table: "stations");

            migrationBuilder.DropTable(
                name: "districts");

            migrationBuilder.DropTable(
                name: "moderation_decisions");

            migrationBuilder.DropTable(
                name: "provinces");

            migrationBuilder.DropIndex(
                name: "IX_stations_district_id",
                table: "stations");

            migrationBuilder.DropIndex(
                name: "IX_care_places_district_id",
                table: "care_places");

            migrationBuilder.DropIndex(
                name: "IX_care_places_slug",
                table: "care_places");

            migrationBuilder.DropCheckConstraint(
                name: "ck_care_places_website",
                table: "care_places");

            migrationBuilder.DropIndex(
                name: "IX_animals_district_id",
                table: "animals");

            migrationBuilder.DropIndex(
                name: "IX_adoption_posts_district_id",
                table: "adoption_posts");

            migrationBuilder.DropIndex(
                name: "IX_adoption_posts_slug",
                table: "adoption_posts");

            migrationBuilder.DropColumn(
                name: "hidden_at",
                table: "urgent_posts");

            migrationBuilder.DropColumn(
                name: "hidden_reason",
                table: "urgent_posts");

            migrationBuilder.DropColumn(
                name: "district_id",
                table: "stations");

            migrationBuilder.DropColumn(
                name: "district",
                table: "care_places");

            migrationBuilder.DropColumn(
                name: "district_id",
                table: "care_places");

            migrationBuilder.DropColumn(
                name: "slug",
                table: "care_places");

            migrationBuilder.DropColumn(
                name: "website",
                table: "care_places");

            migrationBuilder.DropColumn(
                name: "birth_year",
                table: "animals");

            migrationBuilder.DropColumn(
                name: "district_id",
                table: "animals");

            migrationBuilder.DropColumn(
                name: "adopted_at",
                table: "adoption_posts");

            migrationBuilder.DropColumn(
                name: "closed_reason",
                table: "adoption_posts");

            migrationBuilder.DropColumn(
                name: "district_id",
                table: "adoption_posts");

            migrationBuilder.DropColumn(
                name: "slug",
                table: "adoption_posts");
        }
    }
}
