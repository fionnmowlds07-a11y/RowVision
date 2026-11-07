from rowvision_worker import mail


def test_the_result_email_has_a_link_and_no_scores() -> None:
    message = mail.result_ready("a@example.com", "from@example.com", "http://x/clips/1")
    body = message.get_content()
    assert "http://x/clips/1" in body
    assert message["To"] == "a@example.com"


def test_the_tap_email_says_what_to_do() -> None:
    message = mail.needs_tap("a@example.com", "from@example.com", "http://x/clips/1")
    assert "Tap yourself" in message.get_content()
