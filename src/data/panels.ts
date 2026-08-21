export type SocialPlatform =
    | "facebook"
    | "instagram"
    | "tiktok";

export type PaymentPlatform =
    | "cashapp"
    | "venmo"
    | "paypal";

export interface SocialPanel {
    type: "social";
    platform: SocialPlatform;
    name: string;
    followers: number;
    url: string;
    qrColor: string;
}

export interface PaymentPanel {
    type: "payment";
    platform: PaymentPlatform;
    name: string;
    url: string;
    qrColor: string;
}

export const socialPanels: SocialPanel[] = [
    {
        type: "social",
        platform: "facebook",
        name: "Franco's Finds",
        followers: 12450,
        url: "https://www.facebook.com/profile.php?id=61592897452787",
        qrColor: "#1877f2",
    },
    {
        type: "social",
        platform: "instagram",
        name: "@francos_finds",
        followers: 8721,
        url: "https://www.instagram.com/francos_finds/",
        qrColor: "#e1306c",
    },
    {
        type: "social",
        platform: "tiktok",
        name: "@francos_finds",
        followers: 6340,
        url: "https://www.tiktok.com/@francos_finds",
        qrColor: "#000000",
    },
];

export const paymentPanels: PaymentPanel[] = [
    {
        type: "payment",
        platform: "cashapp",
        name: "$franco3445",
        url: "https://cash.app/$franco3445",
        qrColor: "#00c244",
    },
    {
        type: "payment",
        platform: "venmo",
        name: "@franco3445",
        url: "https://venmo.com/code?user_id=1786268014870528090",
        qrColor: "#3d95ce",
    },
    {
        type: "payment",
        platform: "paypal",
        name: "Gilberto Franco",
        url: "https://www.paypal.me/franco3445",
        qrColor: "#003087",
    },
];