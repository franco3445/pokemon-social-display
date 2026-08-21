import {
    Camera,
    CircleDollarSign,
    CreditCard,
    Music2,
    ScanFace,
    Wallet,
} from "lucide-react";

import { QRCodeSVG } from "qrcode.react";

interface PanelProps {
    followers?: number;
    name: string;
    platform: string;
    pokemon: string;
    qrColor: string;
    type: "social" | "payment";
    url: string;
}

function getIcon(platform: string) {
    switch (platform) {
        case "facebook":
            return <ScanFace size={42} />;

        case "instagram":
            return <Camera size={42} />;

        case "tiktok":
            return <Music2 size={42} />;

        case "cashapp":
            return <CircleDollarSign size={42} />;

        case "venmo":
            return <CreditCard size={42} />;

        case "paypal":
            return <Wallet size={42} />;

        default:
            return <Wallet size={42} />;
    }
}

function getPlatformName(platform: string) {
    switch (platform) {
        case "cashapp":
            return "CASH APP";

        default:
            return platform.toUpperCase();
    }
}

export default function Panel({
    platform,
    name,
    followers,
    url,
    type,
    qrColor,
}: PanelProps) {

    return (
        <div className={`pokemon-panel ${type}-panel`}>

            <div className="panel-icon">
                {getIcon(platform)}
            </div>

            <h2>
                {getPlatformName(platform)}
            </h2>

            {type === "social" && followers !== undefined && (
                <div className="followers">
                    <strong>
                        {followers.toLocaleString()}
                    </strong>

                    <span>FOLLOWERS</span>
                </div>
            )}

            <div className="qr-container">
                <QRCodeSVG
                    bgColor="#ffffff"
                    fgColor={qrColor}
                    level="H"
                    size={150}
                    value={url}
                />
            </div>

            <div className="panel-name">
                {name}
            </div>

            <div className="scan-text">
                SCAN TO {type === "social" ? "FOLLOW" : "PAY"}
            </div>

            <div className="scan-line" />

        </div>
    );
}