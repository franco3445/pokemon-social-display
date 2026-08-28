import {
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";

/* =========================================
   BALL TYPES

   Each entry is one Poke Ball variant. The
   ball switches to a different variant every
   time it bounces off a screen edge.
========================================= */

type BallType = {
    name: string;
    top: string;
    bottom: string;
    button: string;
    accent: ReactNode;
};

const BALL_TYPES: BallType[] = [
    {
        name: "POKE BALL",
        top: "#d93232",
        bottom: "#eeeeee",
        button: "#ffffff",
        accent: null,
    },
    {
        name: "GREAT BALL",
        top: "#2f6fd0",
        bottom: "#eeeeee",
        button: "#ffffff",
        accent: (
            <>
                <path
                    d="M50 4 L26 44 L14 44 L38 4 Z"
                    fill="#d93232"
                />

                <path
                    d="M50 4 L74 44 L86 44 L62 4 Z"
                    fill="#d93232"
                />
            </>
        ),
    },
    {
        name: "ULTRA BALL",
        top: "#1b1b1b",
        bottom: "#eeeeee",
        button: "#ffffff",
        accent: (
            <>
                <rect
                    x="16"
                    y="12"
                    width="16"
                    height="32"
                    fill="#f5c542"
                />

                <rect
                    x="68"
                    y="12"
                    width="16"
                    height="32"
                    fill="#f5c542"
                />

                <rect
                    x="16"
                    y="22"
                    width="68"
                    height="12"
                    fill="#f5c542"
                />
            </>
        ),
    },
    {
        name: "MASTER BALL",
        top: "#6b3fa0",
        bottom: "#eeeeee",
        button: "#ff7bd0",
        accent: (
            <>
                <path
                    d="M34 44 L38 14 L50 30 L62 14 L66 44 L58 44 L56 27 L50 36 L44 27 L42 44 Z"
                    fill="#f7f2ff"
                />

                <circle
                    cx="20"
                    cy="26"
                    r="7"
                    fill="#ff7bd0"
                />

                <circle
                    cx="80"
                    cy="26"
                    r="7"
                    fill="#ff7bd0"
                />
            </>
        ),
    },
    {
        name: "SAFARI BALL",
        top: "#8a9a4a",
        bottom: "#dfe3c8",
        button: "#ffffff",
        accent: (
            <>
                <ellipse
                    cx="28"
                    cy="24"
                    rx="12"
                    ry="9"
                    fill="#5f6b30"
                />

                <ellipse
                    cx="64"
                    cy="14"
                    rx="14"
                    ry="8"
                    fill="#5f6b30"
                />

                <ellipse
                    cx="74"
                    cy="36"
                    rx="9"
                    ry="6"
                    fill="#5f6b30"
                />
            </>
        ),
    },
    {
        name: "PREMIER BALL",
        top: "#f7f7f7",
        bottom: "#eeeeee",
        button: "#ffffff",
        accent: (
            <circle
                cx="50"
                cy="50"
                r="39"
                fill="none"
                stroke="#d93232"
                strokeWidth="6"
            />
        ),
    },
    {
        name: "DUSK BALL",
        top: "#1f4744",
        bottom: "#2b2b2b",
        button: "#f5c542",
        accent: (
            <path
                d="M50 8 L58 26 L78 26 L62 38 L68 46 L50 34 L32 46 L38 38 L22 26 L42 26 Z"
                fill="#7bd63f"
            />
        ),
    },
    {
        name: "BEAST BALL",
        top: "#4fc3e8",
        bottom: "#e9f6fb",
        button: "#ffe27a",
        accent: (
            <>
                <rect
                    x="4"
                    y="20"
                    width="28"
                    height="10"
                    fill="#2b7fa8"
                />

                <rect
                    x="68"
                    y="20"
                    width="28"
                    height="10"
                    fill="#2b7fa8"
                />

                <circle
                    cx="50"
                    cy="26"
                    r="15"
                    fill="#f4f9ff"
                />

                <circle
                    cx="50"
                    cy="26"
                    r="6"
                    fill="#2b7fa8"
                />
            </>
        ),
    },
];


/* =========================================
   MOTION SETTINGS
========================================= */

const FALLBACK_SIZE = 120;
const SPEED = 200;
const SPIN_PER_SECOND = 80;

export default function BouncingPokeball() {

    const ballRef = useRef<HTMLDivElement>(null);

    const [typeIndex, setTypeIndex] = useState(0);

    const position = useRef({
        x: 60,
        y: 160,
    });

    const velocity = useRef({
        x: SPEED * 0.78,
        y: SPEED * 0.62,
    });

    const spin = useRef(0);

    useEffect(() => {

        const node = ballRef.current;

        if (!node) {
            return;
        }

        let size = node.offsetWidth || FALLBACK_SIZE;

        // The ball shrinks at the mobile breakpoint,
        // so re-measure whenever the viewport changes.
        const onResize = () => {
            size = node.offsetWidth || FALLBACK_SIZE;
        };

        window.addEventListener("resize", onResize);

        const draw = () => {
            node.style.transform =
                `translate3d(${position.current.x}px, ${position.current.y}px, 0)`
                + ` rotate(${spin.current}deg)`;
        };

        draw();

        const reducedMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)"
        ).matches;

        if (reducedMotion) {
            return () => window.removeEventListener("resize", onResize);
        }

        // Pick any variant other than the current one.
        const nextType = (current: number) => {

            const next = Math.floor(
                Math.random() * (BALL_TYPES.length - 1)
            );

            return next >= current
                ? next + 1
                : next;
        };

        let frame = 0;
        let last = performance.now();

        const step = (now: number) => {

            // Clamped so a backgrounded tab does not
            // teleport the ball across the screen.
            const delta = Math.min(
                (now - last) / 1000,
                0.05
            );

            last = now;

            const maxX = Math.max(
                window.innerWidth - size,
                0
            );

            const maxY = Math.max(
                window.innerHeight - size,
                0
            );

            let bounced = false;

            position.current.x += velocity.current.x * delta;
            position.current.y += velocity.current.y * delta;

            if (position.current.x <= 0) {
                position.current.x = 0;
                velocity.current.x = Math.abs(velocity.current.x);
                bounced = true;
            }
            else if (position.current.x >= maxX) {
                position.current.x = maxX;
                velocity.current.x = -Math.abs(velocity.current.x);
                bounced = true;
            }

            if (position.current.y <= 0) {
                position.current.y = 0;
                velocity.current.y = Math.abs(velocity.current.y);
                bounced = true;
            }
            else if (position.current.y >= maxY) {
                position.current.y = maxY;
                velocity.current.y = -Math.abs(velocity.current.y);
                bounced = true;
            }

            spin.current +=
                (velocity.current.x > 0 ? 1 : -1)
                * SPIN_PER_SECOND
                * delta;

            if (bounced) {
                setTypeIndex(nextType);
            }

            draw();

            frame = requestAnimationFrame(step);
        };

        frame = requestAnimationFrame(step);

        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("resize", onResize);
        };

    }, []);

    const ball = BALL_TYPES[typeIndex];

    return (
        <div
            ref={ballRef}
            className="bouncing-pokeball"
            aria-hidden="true"
            data-ball={ball.name}
        >

            <svg
                viewBox="0 0 100 100"
                width="100%"
                height="100%"
            >

                <defs>

                    <clipPath id="bouncing-pokeball-clip">
                        <circle
                            cx="50"
                            cy="50"
                            r="47"
                        />
                    </clipPath>

                </defs>

                <g clipPath="url(#bouncing-pokeball-clip)">

                    <rect
                        x="0"
                        y="0"
                        width="100"
                        height="50"
                        fill={ball.top}
                    />

                    <rect
                        x="0"
                        y="50"
                        width="100"
                        height="50"
                        fill={ball.bottom}
                    />

                    {ball.accent}

                    <rect
                        x="0"
                        y="44"
                        width="100"
                        height="12"
                        fill="#111111"
                    />

                </g>

                <circle
                    cx="50"
                    cy="50"
                    r="47"
                    fill="none"
                    stroke="#111111"
                    strokeWidth="6"
                />

                <circle
                    cx="50"
                    cy="50"
                    r="15"
                    fill="#111111"
                />

                <circle
                    cx="50"
                    cy="50"
                    r="10"
                    fill={ball.button}
                />

            </svg>

        </div>
    );
}
