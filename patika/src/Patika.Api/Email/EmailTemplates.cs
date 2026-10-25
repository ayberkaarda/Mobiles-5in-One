using System.Globalization;

namespace Patika.Api.Email;

/// <summary>Turkish message templates for the auth flows. Bodies are plain text; codes sit on a line of their own.</summary>
public static class AuthEmails
{
    public static EmailMessage Verification(string to, string code) => new(
        to,
        EmailKind.VerifyEmail,
        "Patika: e-posta adresini doğrula",
        $"Patika hesabını etkinleştirmek için bu 6 haneli kodu uygulamada gir (15 dakika geçerli):\n\n{code}\n\n"
        + "Kodu kimseyle paylaşma. Yeni bir kod istersen öncekiler geçersiz olur.\n\n"
        + "Bu isteği sen yapmadıysan bu iletiyi yok sayabilirsin.");

    public static EmailMessage RegistrationAttempt(string to) => new(
        to,
        EmailKind.RegistrationAttempt,
        "Patika: hesabın için kayıt denemesi",
        "Bu e-posta adresiyle zaten bir Patika hesabı var. Yeni bir kayıt denendi; hesabın değişmedi.\n\n"
        + "Sen değilsen bir şey yapmana gerek yok. Şifreni hatırlamıyorsan uygulamadaki giriş ekranını kullan.");

    public static EmailMessage PasswordReset(string to, string code) => new(
        to,
        EmailKind.PasswordReset,
        "Patika: şifre sıfırlama kodu",
        $"Patika şifreni sıfırlamak için bu 6 haneli kodu uygulamada gir (15 dakika geçerli, yalnızca bir kez kullanılabilir):\n\n{code}\n\n"
        + "Kodu kimseyle paylaşma. Yeni bir kod istersen öncekiler geçersiz olur.\n\n"
        + "Şifren değişince tüm cihazlardaki oturumların kapanır.\n\n"
        + "Bu isteği sen yapmadıysan bu iletiyi yok sayabilirsin; şifren değişmedi.");
}

public static class AccountEmails
{
    /// <summary>Turkey has used a fixed UTC+3 offset since 2016.</summary>
    private static readonly TimeSpan TurkeyOffset = TimeSpan.FromHours(3);

    private static readonly CultureInfo Turkish = CultureInfo.GetCultureInfo("tr-TR");

    public static EmailMessage DeletionScheduled(string to, DateTimeOffset executeAfter) => new(
        to,
        EmailKind.DeletionScheduled,
        "Patika: hesap silme isteğin alındı",
        "Patika hesabını silme isteğini aldık. Hesabın şimdi devre dışı: oturumların kapatıldı, "
        + "bildirimlerin ve takip ettiğin hayvanlar kaldırıldı, açık sahiplendirme ilanların kapatıldı.\n\n"
        + $"Hesabın ve kişisel verilerin {FormatDate(executeAfter)} tarihinden sonra kalıcı olarak silinecek. "
        + "Beslenme ve görülme kayıtların istasyon geçmişi için adın olmadan saklanır.\n\n"
        + "Fikrini değiştirirsen bu tarihten önce uygulamada yeniden giriş yapman yeterli; silme iptal edilir.\n\n"
        + "Bu isteği sen yapmadıysan hemen giriş yap ve şifreni değiştir.");

    internal static string FormatDate(DateTimeOffset value) =>
        value.ToOffset(TurkeyOffset).ToString("d MMMM yyyy HH:mm", Turkish);
}
