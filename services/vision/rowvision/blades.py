"""Rules for measuring a rower's blade."""


def blade_faces_camera(side: str, facing: int) -> bool:
    """Return True when the rower's blade is on the camera's side of the boat.

    A rower facing image-right shows the camera their right side. Stroke side rowers have their
    oar on the right and bow side on the left. Scullers have a blade on each side, so one always
    faces the camera. Blades on the far side are left out, as the hull hides the water below them.

    `facing` is +1 for image-right, -1 for image-left and 0 when it is not known.
    """
    if side == "scull":
        return True
    if side == "stroke":
        return facing > 0
    if side == "bow":
        return facing < 0
    raise ValueError(f"unknown side: {side}")
