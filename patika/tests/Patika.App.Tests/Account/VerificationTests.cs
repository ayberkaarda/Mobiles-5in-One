using System.Net;
using Patika.App.Core.Navigation;
using Patika.App.ViewModels.Account;
using Patika.Contracts.Auth;
using Xunit;

namespace Patika.App.Tests.Account;

public sealed class VerificationTests
{
    private const string Email = "elif@ornek.test";

    private readonly FakeNavigation navigation = new();

    private (VerifyViewModel Model, TestApi Api) Create(Func<RecordedRequest, HttpResponseMessage> respond)
    {
        var api = new TestApi(r => Http.Done(respond(r)));
        var push = new PushHarness(api);
        var session = new AccountSession(api.Client, push.Registration, new MemoryDeletionStore(), api.Clock);
        var model = new VerifyViewModel(api.Client, session, navigation, api.Clock);
        model.ApplyQuery(new Dictionary<string, object> { [Routes.Keys.Email] = Email });
        return (model, api);
    }

    private static HttpResponseMessage Accepted() => Http.Json(HttpStatusCode.Accepted, RegisterAcceptedResponse.Pending);

    [Fact]
    public void Resend_waits_a_minute_after_the_screen_opens()
    {
        var (model, api) = Create(_ => Accepted());

        Assert.False(model.CanResend);
        Assert.Equal("Kodu yeniden gönder, 1:00", model.ResendLabel);

        api.Clock.Advance(TimeSpan.FromSeconds(18));
        Assert.Equal("Kodu yeniden gönder, 0:42", model.ResendLabel);
        Assert.False(model.CanResend);

        api.Clock.Advance(TimeSpan.FromSeconds(42));
        model.Tick();
        Assert.True(model.CanResend);
        Assert.Equal("Kodu yeniden gönder", model.ResendLabel);
    }

    [Fact]
    public async Task Resend_before_the_minute_sends_nothing()
    {
        var (model, api) = Create(_ => Accepted());

        await model.ResendCommand.ExecuteAsync(null);

        Assert.Empty(api.Handler.Requests);
    }

    [Fact]
    public async Task A_resend_sends_a_new_code_clears_the_field_and_restarts_the_wait()
    {
        var (model, api) = Create(_ => Accepted());
        model.Code = "12";
        api.Clock.Advance(ResendCooldown.AfterSend);

        await model.ResendCommand.ExecuteAsync(null);

        var request = Assert.Single(api.Sent("/v1/auth/verify-email/resend"));
        Assert.Equal(Email, TestApi.Body(request).GetProperty("email").GetString());
        Assert.Equal(AccountText.CodeSent, model.Notice);
        Assert.Equal("", model.Code);
        Assert.False(model.CanResend);
        Assert.Equal("Kodu yeniden gönder, 1:00", model.ResendLabel);
    }

    [Fact]
    public async Task Too_many_resends_shows_the_limit_and_waits_five_minutes()
    {
        var (model, api) = Create(_ => Http.Problem(429, "rate_limited"));
        api.Clock.Advance(ResendCooldown.AfterSend);

        await model.ResendCommand.ExecuteAsync(null);

        Assert.Equal("Çok fazla deneme yapıldı. Biraz bekleyip yeniden dene.", model.ErrorMessage);
        Assert.Null(model.Notice);
        Assert.Equal("Kodu yeniden gönder, 5:00", model.ResendLabel);
        api.Clock.Advance(ResendCooldown.AfterRateLimit);
        Assert.True(model.CanResend);
    }

    [Fact]
    public async Task A_wrong_code_is_cleared_with_a_message_and_nothing_navigates()
    {
        var (model, api) = Create(_ => Http.Problem(400, "verification_invalid"));

        model.Code = "123456";
        await model.VerifyCommand.ExecutionTask!;

        Assert.Single(api.Sent("/v1/auth/verify-email"));
        Assert.Equal(AccountText.CodeInvalid, model.ErrorMessage);
        Assert.Equal("", model.Code);
        Assert.Empty(navigation.Visits);
        Assert.Null(api.Tokens.UserId);
    }

    [Fact]
    public async Task Six_digits_verify_without_another_tap_and_start_the_session()
    {
        var (model, api) = Create(r => Http.Json(HttpStatusCode.OK, Http.Tokens(Ids.User, "v")));

        model.Code = "48 2a91-7";
        Assert.Equal("482917", model.Code);
        await model.VerifyCommand.ExecutionTask!;

        var body = TestApi.Body(Assert.Single(api.Sent("/v1/auth/verify-email")));
        Assert.Equal("482917", body.GetProperty("code").GetString());
        Assert.Equal(Email, body.GetProperty("email").GetString());
        Assert.Equal(Ids.User, api.Tokens.UserId);
        Assert.Equal(Routes.Map, navigation.Last);
    }

    [Theory]
    [InlineData("482 917")]
    [InlineData("482-917")]
    [InlineData(" 4 8 2 9 1 7 ")]
    public async Task A_pasted_code_with_separators_fits_the_field_and_completes(string pasted)
    {
        var (model, api) = Create(r => Http.Json(HttpStatusCode.OK, Http.Tokens(Ids.User, "v")));

        // The field limit must not cut the paste before it is cleaned; then the field's handler runs.
        Assert.True(pasted.Length <= CodeEntryViewModel.MaxInputLength);
        model.AcceptInput(pasted[..Math.Min(pasted.Length, CodeEntryViewModel.MaxInputLength)]);
        await model.VerifyCommand.ExecutionTask!;

        Assert.Equal("482917", model.Code);
        Assert.Equal("482917", TestApi.Body(Assert.Single(api.Sent("/v1/auth/verify-email"))).GetProperty("code").GetString());
        Assert.Equal(Routes.Map, navigation.Last);
    }

    [Fact]
    public void Input_is_reduced_to_digits_before_it_is_limited_to_six() =>
        Assert.Equal("123456", CodeEntryViewModel.Normalize("1-2-3 4.5 6 7 8"));

    [Fact]
    public async Task Fewer_than_six_digits_ask_for_the_whole_code()
    {
        var (model, api) = Create(_ => Accepted());
        model.Code = "4821";

        await model.VerifyCommand.ExecuteAsync(null);

        Assert.Equal(AccountText.CodeFormat, model.ErrorMessage);
        Assert.Empty(api.Handler.Requests);
        Assert.Equal(["4", "8", "2", "1", "", ""], model.Digits);
    }
}

public sealed class PasswordResetTests
{
    private const string Email = "elif@ornek.test";

    [Fact]
    public async Task A_wrong_reset_code_says_so_and_a_good_one_returns_to_sign_in_with_a_notice()
    {
        var accept = false;
        var api = new TestApi(r => Http.Done(accept ? new HttpResponseMessage(HttpStatusCode.NoContent) : Http.Problem(400, "reset_invalid")));
        var navigation = new FakeNavigation();
        var model = new ResetPasswordViewModel(api.Client, navigation, api.Clock);
        model.ApplyQuery(new Dictionary<string, object> { [Routes.Keys.Email] = Email });
        model.NewPassword = "yeni-uzun-sifre";

        model.Code = "111111";
        await model.ResetCommand.ExecuteAsync(null);
        Assert.Equal(AccountText.CodeInvalid, model.ErrorMessage);
        Assert.Equal("", model.Code);
        Assert.Empty(navigation.Visits);

        accept = true;
        model.Code = "222222";
        await model.ResetCommand.ExecuteAsync(null);

        var body = TestApi.Body(api.Sent("/v1/auth/reset")[^1]);
        Assert.Equal("222222", body.GetProperty("code").GetString());
        Assert.Equal("yeni-uzun-sifre", body.GetProperty("newPassword").GetString());
        Assert.Equal(Routes.SignIn, navigation.Last);
        Assert.Equal(AccountText.PasswordChanged, navigation.Visits[^1].Parameters![AccountRoutes.NoticeKey]);
        Assert.Equal("", model.NewPassword);
    }

    [Fact]
    public async Task A_short_new_password_is_refused_before_sending()
    {
        var api = new TestApi(_ => Http.Done(new HttpResponseMessage(HttpStatusCode.NoContent)));
        var model = new ResetPasswordViewModel(api.Client, new FakeNavigation(), api.Clock) { Code = "123456", NewPassword = "kisa" };

        await model.ResetCommand.ExecuteAsync(null);

        Assert.Equal(AccountText.PasswordRule, model.ErrorMessage);
        Assert.Empty(api.Handler.Requests);
    }

    [Fact]
    public async Task Forgot_password_asks_for_a_code_and_opens_the_reset_screen()
    {
        var api = new TestApi(_ => Http.Done(Http.Json(HttpStatusCode.Accepted, ForgotPasswordAcceptedResponse.Pending)));
        var navigation = new FakeNavigation();
        var model = new ForgotPasswordViewModel(api.Client, navigation) { Email = " elif@ornek.test " };

        await model.SendCommand.ExecuteAsync(null);

        Assert.Equal(Email, TestApi.Body(Assert.Single(api.Sent("/v1/auth/forgot"))).GetProperty("email").GetString());
        Assert.Equal(AccountRoutes.ResetPassword, navigation.Last);
        Assert.Equal(Email, navigation.Visits[^1].Parameters![Routes.Keys.Email]);
    }
}
