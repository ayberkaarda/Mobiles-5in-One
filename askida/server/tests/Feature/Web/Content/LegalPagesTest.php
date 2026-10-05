<?php

use App\Domain\Web\Content\LegalRepository;
use App\Models\User;
use App\Support\Web\Facts;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Web\Support\WebPage;

uses(RefreshDatabase::class);

/*
| The two legal pages are labelled samples: a visible notice, no data controller, address or
| mailbox, the anonymity statement of the recipient flow and the KVKK text version that the
| API accepts.
*/

beforeEach(function (): void {
    WebPage::isolate();
});

dataset('legal paths', ['/gizlilik', '/kvkk-aydinlatma']);

/**
 * The page's main content (without the head's JSON-LD, which legitimately contains "@context").
 */
function legalMain(string $html): string
{
    preg_match('#<main id="main">(.*?)</main>#s', $html, $main);

    return $main[1];
}

it('renders a legal page under the public page contract with the sample notice', function (string $path): void {
    $html = WebPage::assertPublicPage($this->get($path), 'tr', WebPage::BUDGET_LONG);

    expect($html)->toContain('class="sample-notice"')
        ->toContain('Örnek metin: hukuki inceleme öncesi taslaktır.')
        ->toContain('<link rel="canonical" href="https://askida.app'.$path.'">');

    // The notice sits at the top: before <main>.
    expect(strpos($html, 'sample-notice'))->toBeLessThan(strpos($html, '<main id="main">'));
})->with('legal paths');

it('names no data controller, address or mailbox', function (string $path): void {
    $html = (string) $this->get($path)->getContent();
    $main = legalMain($html);

    expect($main)->not->toContain('@')
        ->not->toContain('mailto:')
        ->not->toContain(Facts::contactEmail())
        ->and(mb_strtolower($main))->toContain('veri sorumlusu bu örnekte belirlenmemiştir');
})->with('legal paths');

it('keeps the mailbox and address out of the legal sources and views', function (): void {
    $files = [
        resource_path('content/legal/gizlilik.md'),
        resource_path('content/legal/kvkk-aydinlatma.md'),
        resource_path('views/web/content/legal.blade.php'),
    ];

    foreach ($files as $file) {
        $source = (string) file_get_contents($file);

        expect($source)->not->toContain('@')->not->toContain('mailto:', basename($file));
    }
});

it('states the anonymity of the recipient on the KVKK page', function (): void {
    $html = html_entity_decode(legalMain((string) $this->get('/kvkk-aydinlatma')->getContent()));

    expect($html)->toContain('Hesap yoktur.')
        ->toContain('Kimlik yoktur.')
        ->toContain('Kesin konum yoktur.')
        ->toContain('Puan yoktur.')
        ->toContain('30 gün')
        ->toContain('cihaz doğrulama sonucu');
});

it('shows the KVKK text version that the API accepts and stores', function (): void {
    AuthTestKit::boot();

    $html = (string) $this->get('/kvkk-aydinlatma')->getContent();

    expect($html)->toContain('Metin sürümü: '.Facts::KVKK_TEXT_VERSION);

    $payload = AuthTestKit::registerPayload(['kvkk_text_version' => Facts::KVKK_TEXT_VERSION]);

    $this->postJson('/api/v1/auth/register', $payload)->assertCreated();

    expect(DB::table('kvkk_consents')->sole()->text_version)->toBe(Facts::KVKK_TEXT_VERSION)
        ->and(User::query()->count())->toBe(1);
});

it('does not show the text version on the privacy page', function (): void {
    expect((string) $this->get('/gizlilik')->getContent())->not->toContain('Metin sürümü');
});

it('gives each legal page its own short answer, title and description', function (): void {
    $pages = app(LegalRepository::class)->all();

    expect($pages)->toHaveCount(2)
        ->and($pages[0]->answer)->not->toBe($pages[1]->answer)
        ->and($pages[0]->title)->not->toBe($pages[1]->title);
});

it('answers 404 for a legal slug that does not exist', function (): void {
    $this->get('/kvkk')->assertNotFound();
});
