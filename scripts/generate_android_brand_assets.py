from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
RES_DIR = ROOT / "android" / "app" / "src" / "main" / "res"

ICON_SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

SPLASH_SIZES = {
    "drawable": (1280, 2560),
    "drawable-port-mdpi": (320, 480),
    "drawable-port-hdpi": (480, 800),
    "drawable-port-xhdpi": (720, 1280),
    "drawable-port-xxhdpi": (960, 1600),
    "drawable-port-xxxhdpi": (1280, 1920),
    "drawable-land-mdpi": (480, 320),
    "drawable-land-hdpi": (800, 480),
    "drawable-land-xhdpi": (1280, 720),
    "drawable-land-xxhdpi": (1600, 960),
    "drawable-land-xxxhdpi": (1920, 1280),
}

BLUE = (27, 116, 228, 255)
BLUE_LIGHT = (90, 163, 255, 255)
BLUE_DARK = (20, 87, 199, 255)
WHITE = (255, 255, 255, 255)
WHITE_SOFT = (217, 235, 255, 255)
SPLASH_BG = (245, 247, 251, 255)
SHADOW = (27, 116, 228, 60)


def rounded_gradient(size: int, circle: bool = False) -> Image.Image:
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gradient = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gradient_draw = ImageDraw.Draw(gradient)

    for y in range(size):
        ratio = y / max(size - 1, 1)
        red = round(BLUE_LIGHT[0] * (1 - ratio) + BLUE_DARK[0] * ratio)
        green = round(BLUE_LIGHT[1] * (1 - ratio) + BLUE_DARK[1] * ratio)
        blue = round(BLUE_LIGHT[2] * (1 - ratio) + BLUE_DARK[2] * ratio)
        gradient_draw.line((0, y, size, y), fill=(red, green, blue, 255))

    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    inset = max(1, round(size * 0.04))
    if circle:
        mask_draw.ellipse((inset, inset, size - inset, size - inset), fill=255)
    else:
        radius = round(size * 0.31)
        mask_draw.rounded_rectangle((inset, inset, size - inset, size - inset), radius=radius, fill=255)

    icon.paste(gradient, (0, 0), mask)

    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    overlay_draw.ellipse(
        (
            round(size * 0.15),
            round(size * 0.08),
            round(size * 0.82),
            round(size * 0.48),
        ),
        fill=(255, 255, 255, 38),
    )
    icon = Image.alpha_composite(icon, overlay)
    return icon


def draw_wallet(base: Image.Image, circular: bool = False) -> Image.Image:
    size = base.size[0]
    wallet_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(wallet_layer)

    flap = (
        round(size * 0.23),
        round(size * 0.30),
        round(size * 0.77),
        round(size * 0.49),
    )
    body = (
        round(size * 0.20),
        round(size * 0.40),
        round(size * 0.80),
        round(size * 0.70),
    )
    dot = (
        round(size * 0.66),
        round(size * 0.48),
        round(size * 0.75),
        round(size * 0.57),
    )
    highlight = (
        round(size * 0.33),
        round(size * 0.33),
        round(size * 0.57),
        round(size * 0.37),
    )

    draw.rounded_rectangle(flap, radius=round(size * 0.10), fill=WHITE)
    draw.rounded_rectangle(body, radius=round(size * 0.14), fill=WHITE)
    draw.ellipse(dot, fill=WHITE_SOFT if circular else (223, 238, 255, 255))
    draw.rounded_rectangle(highlight, radius=round(size * 0.04), fill=(217, 235, 255, 255))

    shadow_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow_layer)
    shadow_offset = round(size * 0.018)
    shadow_draw.rounded_rectangle(
        (body[0], body[1] + shadow_offset, body[2], body[3] + shadow_offset),
        radius=round(size * 0.14),
        fill=SHADOW,
    )
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(max(2, round(size * 0.02))))

    result = Image.alpha_composite(base, shadow_layer)
    return Image.alpha_composite(result, wallet_layer)


def make_square_icon(size: int) -> Image.Image:
    return draw_wallet(rounded_gradient(size, circle=False))


def make_round_icon(size: int) -> Image.Image:
    return draw_wallet(rounded_gradient(size, circle=True), circular=True)


def make_splash(width: int, height: int) -> Image.Image:
    image = Image.new("RGBA", (width, height), SPLASH_BG)
    shadow_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    logo_size = max(96, round(min(width, height) * 0.19))
    x = (width - logo_size) // 2
    y = (height - logo_size) // 2

    shadow_draw = ImageDraw.Draw(shadow_layer)
    shadow_box = (x, y + round(logo_size * 0.06), x + logo_size, y + logo_size + round(logo_size * 0.06))
    shadow_draw.rounded_rectangle(shadow_box, radius=round(logo_size * 0.31), fill=SHADOW)
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(max(4, round(logo_size * 0.08))))
    image = Image.alpha_composite(image, shadow_layer)

    icon = make_square_icon(logo_size)
    image.alpha_composite(icon, (x, y))
    return image


def save_png(image: Image.Image, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, format="PNG")


def generate_icons() -> None:
    for folder, size in ICON_SIZES.items():
        square_icon = make_square_icon(size)
        round_icon = make_round_icon(size)
        save_png(square_icon, RES_DIR / folder / "ic_launcher.png")
        save_png(square_icon, RES_DIR / folder / "ic_launcher_foreground.png")
        save_png(round_icon, RES_DIR / folder / "ic_launcher_round.png")


def generate_splashes() -> None:
    for folder, (width, height) in SPLASH_SIZES.items():
        splash = make_splash(width, height)
        save_png(splash, RES_DIR / folder / "splash.png")


if __name__ == "__main__":
    generate_icons()
    generate_splashes()
    print("Android brand assets generated.")
