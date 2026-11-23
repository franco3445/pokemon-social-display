import {
    Camera,
    CircleDollarSign,
    CreditCard,
    Music2,
    ScanFace,
    Wallet,
} from "lucide-react";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";

interface PanelProps {
    followers?: number;
    likes?: number;
    name: string;
    platform: string;
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


const COUNT_DURATION_MS = 1400;

/**
 * Tweens the displayed number from whatever it currently shows to `target`,
 * easing out so it rolls quickly then settles. Jumps straight there when the
 * viewer prefers reduced motion.
 */
function useCountUp(target: number) {
    const [display, setDisplay] = useState(target);
    const displayRef = useRef(target);

    useEffect(() => {
        const from = displayRef.current;
        if (from === target) return;

        const reduced = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
        ).matches;
        const duration = reduced ? 0 : COUNT_DURATION_MS;
        const startedAt = performance.now();
        let frame = 0;

        const tick = (now: number) => {
            const t = duration > 0 ? Math.min((now - startedAt) / duration, 1) : 1;
            const eased = 1 - Math.pow(1 - t, 3);
            const value = Math.round(from + (target - from) * eased);

            displayRef.current = value;
            setDisplay(value);

            if (t < 1) frame = requestAnimationFrame(tick);
        };

        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [target]);

    return display;
}

interface StatChange {
    delta: number;
    // Bumped on every change so the animated elements remount and replay.
    id: number;
}

function AnimatedStat({ value, label }: { value: number; label: string }) {
    const display = useCountUp(value);

    // Track the previous value during render (React's recommended pattern for
    // reacting to a prop change) so the delta is known on the same render.
    const [prevValue, setPrevValue] = useState(value);
    const [change, setChange] = useState<StatChange | null>(null);

    if (value !== prevValue) {
        setPrevValue(value);
        setChange({ delta: value - prevValue, id: (change?.id ?? 0) + 1 });
    }

    const direction = change ? (change.delta > 0 ? "up" : "down") : "";

    return (
        <div className={`followers stat ${direction && `stat-${direction}`}`}>
            <strong
                className={change ? "stat-value stat-pop" : "stat-value"}
                key={`value-${change?.id ?? 0}`}
            >
                {display.toLocaleString()}
            </strong>

            <span>{label}</span>

            {change && (
                <em aria-hidden="true" className="stat-delta" key={`delta-${change.id}`}>
                    {change.delta > 0 ? "+" : "−"}
                    {Math.abs(change.delta).toLocaleString()}
                </em>
            )}
        </div>
    );
}

export default function Panel({
    platform,
    name,
    followers,
    likes,
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

            {type === "social" && (followers !== undefined || likes !== undefined) && (
                <div className="panel-stats">

                    {followers !== undefined && (
                        <AnimatedStat label="FOLLOWERS" value={followers} />
                    )}

                    {likes !== undefined && (
                        <AnimatedStat label="LIKES" value={likes} />
                    )}

                </div>
            )}

            <a
                aria-label={`Open ${getPlatformName(platform)} link for ${name}`}
                className="qr-container"
                href={url}
                rel="noopener noreferrer"
                target="_blank"
            >
                <QRCodeSVG
                    bgColor="#ffffff"
                    fgColor={qrColor}
                    level="H"
                    size={150}
                    value={url}
                />
            </a>

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