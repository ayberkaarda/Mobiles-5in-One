from email.message import EmailMessage
from urllib.parse import urlencode

import aiosmtplib
import structlog
from aiosmtplib.errors import SMTPException

from app.core.deps import OutgoingMail
from app.core.errors import INTERNAL, ProblemError
from app.core.settings import Settings


def magic_link_mail(email: str, token: str, settings: Settings) -> OutgoingMail:
    link = settings.magic_link_base_url + "#" + urlencode({"token": token})
    return OutgoingMail(
        to=email,
        subject="İnecek Var giriş bağlantınız",
        text="Giriş yapmak için bu bağlantıyı açın:\n" + link + "\nBağlantı 15 dakika geçerlidir.",
        category="security",
    )


def account_exists_mail(email: str, token: str, settings: Settings) -> OutgoingMail:
    link = settings.magic_link_base_url + "#" + urlencode({"token": token})
    return OutgoingMail(
        to=email,
        subject="İnecek Var hesabınıza giriş",
        text="Bu adresle bir hesabınız var. Giriş bağlantınız:\n"
        + link
        + "\nBağlantı 15 dakika geçerlidir. Parolanız değiştirilmedi.",
        category="security",
    )


class SmtpMailSender:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def send(self, mail: OutgoingMail) -> None:
        message = EmailMessage()
        message["From"] = self.settings.mail_from
        message["To"] = mail.to
        message["Subject"] = mail.subject
        message.set_content(mail.text, charset="utf-8")
        password = self.settings.smtp_password
        try:
            await aiosmtplib.send(
                message,
                hostname=self.settings.smtp_host,
                port=self.settings.smtp_port,
                use_tls=False,
                start_tls=self.settings.smtp_use_tls,
                username=self.settings.smtp_username,
                password=password.get_secret_value() if password else None,
                recipients=[mail.to],
            )
        except (SMTPException, OSError):
            structlog.get_logger().warning("auth.mail.unavailable")
            raise ProblemError(INTERNAL, 503) from None
