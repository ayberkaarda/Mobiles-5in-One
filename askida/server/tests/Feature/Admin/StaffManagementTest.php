<?php

use App\Domain\Admin\Exceptions\LastAdminProtected;
use App\Domain\Admin\Services\AdminRoleManager;
use App\Domain\Auth\Abilities\AdminRole;
use App\Domain\Fraud\Models\AbuseFlag;
use App\Domain\Payments\Models\PaymentMismatch;
use App\Domain\Payments\Models\Payout;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Filament\Resources\ActivityLogResource\Pages\ListActivities;
use App\Filament\Resources\UserResource\Pages\ListUsers;
use App\Filament\Widgets\AdminOverview;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Spatie\Activitylog\Models\Activity;
use Tests\Feature\Admin\Support\AdminTestKit;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

/*
| Staff management (admin only), the last-admin rule, the bootstrap command, the activity
| log page and the dashboard counts.
*/

uses(RefreshDatabase::class);

beforeEach(fn () => AdminTestKit::boot());

/**
 * @return array{int, string}
 */
function runCreateAdmin(string $email, string $role = 'admin'): array
{
    $exit = Artisan::call('admin:create', ['email' => $email, '--role' => $role]);

    return [$exit, Artisan::output()];
}

it('creates a panel account with a one-time password printed once and never logged', function (): void {
    $logged = [];
    Event::listen(MessageLogged::class, function (MessageLogged $event) use (&$logged): void {
        $logged[] = $event->message.' '.json_encode($event->context);
    });

    [$exit, $output] = runCreateAdmin('Ops.Lead@Example.test', 'moderator');

    expect($exit)->toBe(0);
    preg_match('/Temporary password \(shown once, not stored in clear\): (\S+)/', $output, $match);
    $password = $match[1] ?? '';
    expect(strlen($password))->toBe(24);

    $user = User::query()->where('email', 'ops.lead@example.test')->sole();
    expect(Hash::check($password, (string) $user->password))->toBeTrue()
        ->and($user->hasRole('moderator'))->toBeTrue()
        ->and($user->two_factor_confirmed_at)->toBeNull()
        ->and(implode("\n", $logged))->not->toContain($password)
        ->and(Activity::query()->get()->toJson())->not->toContain($password)
        ->and(Activity::query()->where('event', 'admin.user_created')->value('subject_id'))->toBe($user->id);
});

it('refuses a duplicate e-mail, an unknown role and a bad address without changes', function (): void {
    runCreateAdmin('one@example.test');
    $hash = User::query()->where('email', 'one@example.test')->value('password');

    expect(runCreateAdmin('one@example.test')[0])->toBe(1)
        ->and(User::query()->where('email', 'one@example.test')->value('password'))->toBe($hash)
        ->and(User::query()->where('email', 'one@example.test')->sole()->roles()->count())->toBe(1)
        ->and(runCreateAdmin('two@example.test', 'owner')[0])->toBe(1)
        ->and(runCreateAdmin('not-an-address')[0])->toBe(1)
        ->and(User::query()->count())->toBe(1);
});

it('assigns roles idempotently and only for admins', function (): void {
    $admin = AdminTestKit::staff(AdminRole::Admin);
    $target = AdminTestKit::staff(AdminRole::Moderator);
    $manager = app(AdminRoleManager::class);

    expect($manager->assign($target, AdminRole::Finance, $admin))->toBeTrue()
        ->and($manager->assign($target, AdminRole::Finance, $admin))->toBeFalse()
        ->and($target->refresh()->roles()->pluck('name')->sort()->values()->all())->toBe(['finance', 'moderator'])
        ->and(Activity::query()->where('event', 'admin.role_assigned')->count())->toBe(1);

    expect(fn () => $manager->assign($admin, AdminRole::Finance, $target))->toThrow(AuthorizationException::class);
});

it('keeps at least one active admin with confirmed TOTP', function (): void {
    $admin = AdminTestKit::staff(AdminRole::Admin);
    $unconfirmed = AdminTestKit::staff(AdminRole::Admin, confirmed: false);
    $manager = app(AdminRoleManager::class);

    expect(fn () => $manager->revoke($admin, AdminRole::Admin, $admin))->toThrow(LastAdminProtected::class)
        ->and(fn () => $manager->resetTwoFactor($admin, $admin))->toThrow(LastAdminProtected::class)
        ->and($admin->refresh()->hasRole('admin'))->toBeTrue();

    // A second confirmed admin makes the change possible; an unconfirmed one does not count.
    expect($manager->revoke($unconfirmed, AdminRole::Admin, $admin))->toBeTrue();
    $second = AdminTestKit::staff(AdminRole::Admin);
    expect($manager->revoke($admin, AdminRole::Admin, $second))->toBeTrue();
});

it('asks for a fresh TOTP code for role changes in the panel', function (): void {
    $admin = AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Admin));
    $target = AdminTestKit::staff(AdminRole::Moderator);

    Livewire::test(ListUsers::class)
        ->assertCanSeeTableRecords([$admin, $target])
        ->callTableAction('assignRole', $target, data: ['role' => 'finance', 'code' => '000000'])
        ->assertHasTableActionErrors(['code']);
    expect($target->refresh()->hasRole('finance'))->toBeFalse()
        ->and(Activity::query()->where('event', 'admin.totp_failed')->value('causer_id'))->toBe($admin->id);

    Livewire::test(ListUsers::class)
        ->callTableAction('assignRole', $target, data: ['role' => 'finance', 'code' => AdminTestKit::freshCode($admin)])
        ->assertHasNoTableActionErrors();
    expect($target->refresh()->hasRole('finance'))->toBeTrue();

    Livewire::test(ListUsers::class)
        ->callTableAction('resetTwoFactor', $target, data: ['code' => AdminTestKit::freshCode($admin)])
        ->assertHasNoTableActionErrors();
    expect($target->refresh()->two_factor_confirmed_at)->toBeNull()
        ->and($target->two_factor_secret)->toBeNull();
});

it('lists only panel staff, never donors or merchants', function (): void {
    AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Admin));
    $donor = User::factory()->donor()->create();

    Livewire::test(ListUsers::class)->assertCanNotSeeTableRecords([$donor]);
});

it('shows the activity log with ids and allowlisted properties only', function (): void {
    $admin = AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Admin));
    activity('test')->causedBy($admin)->withProperties(['reason' => 'kontrol', 'email' => $admin->email])->event('probe')->log('probe');

    $html = Livewire::test(ListActivities::class)->assertSuccessful()->html();

    expect($html)->toContain('reason: kontrol')
        ->and($html)->not->toContain($admin->email);
});

it('counts pending shops, open mismatches, held payouts and open flags on the dashboard', function (): void {
    AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Admin));
    ShopTestKit::shop(state: ShopVerificationState::Pending);
    PaymentMismatch::factory()->count(2)->create();
    Payout::factory()->create()->forceFill(['hold' => true])->save();
    AbuseFlag::factory()->create();

    Livewire::test(AdminOverview::class)
        ->assertSeeInOrder(['Onay bekleyen işletme', '1', 'Açık mutabakat farkı', '2', 'Bekletilen aktarım', '1', 'İncelenmemiş bulgu', '1']);
});

it('shows a moderator only the moderation counts', function (): void {
    AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Moderator));

    Livewire::test(AdminOverview::class)->assertSee('Onay bekleyen işletme')->assertDontSee('Açık mutabakat farkı');
});
