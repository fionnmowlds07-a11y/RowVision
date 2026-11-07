"""Tell athletes when a clip needs them. Emails carry no footage or scores."""

import smtplib
from email.message import EmailMessage


def result_ready(to: str, sender: str, link: str) -> EmailMessage:
    return _message(to, sender, "Your RowVision result is ready", f"Your clip has been analysed.\n\n{link}\n")


def needs_tap(to: str, sender: str, link: str) -> EmailMessage:
    body = f"We couldn't tell which rower is you. Tap yourself on a frame and we'll carry on.\n\n{link}\n"
    return _message(to, sender, "RowVision needs a quick tap", body)


def _message(to: str, sender: str, subject: str, body: str) -> EmailMessage:
    message = EmailMessage()
    message["To"], message["From"], message["Subject"] = to, sender, subject
    message.set_content(body)
    return message


def send(message: EmailMessage, host: str, port: int) -> None:
    with smtplib.SMTP(host, port, timeout=20) as server:
        server.send_message(message)
