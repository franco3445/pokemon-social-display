import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type CSSProperties,
} from "react";

import {
    ALL_RANGE,
    REGIONS,
    getPokemon,
    normalizeName,
    randomId,
    rangeForGen,
    type Pokemon,
} from "../game/pokeapi";

import "./Game.css";

type Mode = "free" | "quiz";
type Phase = "menu" | "playing" | "gameover" | "congrats";
type GuessResult = "correct" | "wrong" | null;

const QUIZ_GOAL = 5;
const FLASH_MS = 500;
const REVEAL_DELAY_MS = 150;
const GAME_OVER_DELAY_MS = 1800;
const CONGRATS_DELAY_MS = 1800;

// Generation 0 means "any generation".
const ANY_GEN = 0;
const rangeFor = (gen: number): [number, number] =>
    gen === ANY_GEN ? ALL_RANGE : rangeForGen(gen);

export default function Game() {
    const [phase, setPhase] = useState<Phase>("menu");
    const [mode, setMode] = useState<Mode>("free");
    const [generation, setGeneration] = useState(ANY_GEN);

    const [pokemon, setPokemon] = useState<Pokemon | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const [revealed, setRevealed] = useState(false);
    const [flash, setFlash] = useState(false);

    const [guess, setGuess] = useState("");
    const [guessResult, setGuessResult] = useState<GuessResult>(null);
    const [score, setScore] = useState(0);

    const requestId = useRef(0);
    const timers = useRef<number[]>([]);
    const audio = useRef<HTMLAudioElement | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const currentRange = useRef<[number, number]>(ALL_RANGE);
    const nextId = useRef<number | null>(null);

    /* ---------- timers & audio, all cleaned up on unmount ---------- */

    const later = useCallback((fn: () => void, ms: number) => {
        timers.current.push(window.setTimeout(fn, ms));
    }, []);

    const clearTimers = useCallback(() => {
        timers.current.forEach(clearTimeout);
        timers.current = [];
    }, []);

    const stopCry = useCallback(() => {
        audio.current?.pause();
        audio.current = null;
    }, []);

    useEffect(
        () => () => {
            clearTimers();
            stopCry();
            requestId.current++;
        },
        [clearTimers, stopCry],
    );

    const triggerFlash = useCallback(() => {
        setFlash(false);
        // Next frame so the animation restarts even if it was mid-flash.
        requestAnimationFrame(() => setFlash(true));
        later(() => setFlash(false), FLASH_MS);
    }, [later]);

    /* ---------- loading ---------- */

    const loadPokemon = useCallback(
        async (range: [number, number]) => {
            const req = ++requestId.current;
            currentRange.current = range;

            stopCry();
            setLoading(true);
            setError(false);
            setRevealed(false);
            setGuess("");
            setGuessResult(null);
            triggerFlash();

            // Use the prefetched pick when it belongs to this range.
            const queued = nextId.current;
            const id =
                queued !== null && queued >= range[0] && queued <= range[1]
                    ? queued
                    : randomId(range);
            nextId.current = null;

            try {
                const p = await getPokemon(id);
                if (req !== requestId.current) return;

                setPokemon(p);
                setLoading(false);

                // Prefetch the following Pokémon while the player is thinking.
                const upcoming = randomId(range, id);
                nextId.current = upcoming;
                getPokemon(upcoming).catch(() => {
                    if (nextId.current === upcoming) nextId.current = null;
                });
            } catch (err) {
                if (req !== requestId.current) return;
                console.error("Failed to load Pokémon", err);
                setLoading(false);
                setError(true);
            }
        },
        [stopCry, triggerFlash],
    );

    const nextPokemon = useCallback(
        () => loadPokemon(currentRange.current),
        [loadPokemon],
    );

    // Keep the cursor in the guess box for each new quiz round.
    useEffect(() => {
        if (mode === "quiz" && phase === "playing" && !loading && !revealed) {
            inputRef.current?.focus();
        }
    }, [mode, phase, loading, revealed, pokemon]);

    /* ---------- actions ---------- */

    const reveal = useCallback(() => {
        if (!pokemon || revealed) return;
        triggerFlash();

        later(() => {
            setRevealed(true);
            if (pokemon.cry) {
                stopCry();
                const cry = new Audio(pokemon.cry);
                cry.volume = 0.5;
                audio.current = cry;
                // Autoplay can be blocked; the game works fine without sound.
                cry.play().catch(() => {});
            }
        }, REVEAL_DELAY_MS);
    }, [pokemon, revealed, triggerFlash, later, stopCry]);

    const startFreePlay = () => {
        clearTimers();
        setMode("free");
        setScore(0);
        setPhase("playing");
        loadPokemon(rangeFor(generation));
    };

    const startQuiz = () => {
        clearTimers();
        setMode("quiz");
        setScore(0);
        setPhase("playing");
        loadPokemon(ALL_RANGE);
    };

    const goHome = () => {
        clearTimers();
        stopCry();
        requestId.current++;
        setPhase("menu");
        setMode("free");
        setScore(0);
        setGuess("");
        setGuessResult(null);
        setRevealed(false);
        setLoading(false);
        setError(false);
    };

    const changeGeneration = (gen: number) => {
        setGeneration(gen);
        loadPokemon(rangeFor(gen));
    };

    const submitGuess = () => {
        // Locked once a result is in, so a double Enter can't score twice.
        if (!pokemon || loading || guessResult || !guess.trim()) return;

        const correct = pokemon.answers.includes(normalizeName(guess));
        setGuessResult(correct ? "correct" : "wrong");
        reveal();

        if (!correct) {
            later(() => setPhase("gameover"), GAME_OVER_DELAY_MS);
            return;
        }

        const newScore = score + 1;
        setScore(newScore);
        if (newScore >= QUIZ_GOAL) {
            later(() => setPhase("congrats"), CONGRATS_DELAY_MS);
        }
    };

    /* ---------- render ---------- */

    const renderScreen = () => {
        if (phase === "menu") {
            return (
                <div className="wtp-welcome">
                    <h1>Who's That Pokémon?</h1>
                    <p>Test your Pokémon knowledge by guessing hidden Pokémon silhouettes!</p>

                    <div className="wtp-welcome-buttons">
                        <button className="wtp-start" onClick={startFreePlay}>
                            Free Play
                        </button>
                        <button className="wtp-start wtp-start-quiz" onClick={startQuiz}>
                            Quiz Mode
                        </button>
                    </div>
                </div>
            );
        }

        if (phase === "gameover") {
            return (
                <div className="wtp-gameover">
                    <h1>💀 GAME OVER 💀</h1>
                    <p>Final Score: {score}</p>

                    {pokemon && (
                        <>
                            <img
                                src={pokemon.image}
                                alt={pokemon.name}
                                className="wtp-gameover-image"
                            />
                            <div className="wtp-gameover-name">It was {pokemon.name}!</div>
                        </>
                    )}

                    <div className="wtp-button-row">
                        <button onClick={startQuiz}>Try Again</button>
                        <button onClick={goHome}>Home</button>
                    </div>
                </div>
            );
        }

        if (phase === "congrats") {
            return (
                <div className="wtp-congrats">
                    <h1>🎉 Congratulations! 🎉</h1>
                    <p>You correctly guessed {QUIZ_GOAL} Pokémon!</p>

                    <div className="wtp-button-row">
                        <button onClick={startQuiz}>Play Again</button>
                        <button onClick={goHome}>Home</button>
                    </div>
                </div>
            );
        }

        if (error) {
            return (
                <div className="wtp-status">
                    <p>Couldn't reach the Pokédex.</p>
                    <button onClick={nextPokemon}>Retry</button>
                </div>
            );
        }

        if (!pokemon || loading) {
            return (
                <div className="wtp-status" aria-live="polite">
                    <div className="wtp-spinner" />
                    <p>Loading…</p>
                </div>
            );
        }

        if (!revealed) {
            const isQuiz = mode === "quiz";

            return (
                <>
                    <button
                        type="button"
                        className="wtp-silhouette"
                        onClick={() => !isQuiz && reveal()}
                        disabled={isQuiz}
                        aria-label={isQuiz ? "Hidden Pokémon" : "Reveal Pokémon"}
                    >
                        <span
                            className="wtp-silhouette-fill"
                            style={{ "--img": `url(${pokemon.image})` } as CSSProperties}
                        />
                    </button>

                    <div className="wtp-mystery">Who’s that Pokémon?</div>

                    {isQuiz && (
                        <form
                            className="wtp-quiz"
                            onSubmit={(e) => {
                                e.preventDefault();
                                submitGuess();
                            }}
                        >
                            <input
                                ref={inputRef}
                                type="text"
                                value={guess}
                                placeholder="Enter Pokémon name"
                                autoComplete="off"
                                autoCapitalize="off"
                                spellCheck={false}
                                disabled={guessResult !== null}
                                onChange={(e) => setGuess(e.target.value)}
                            />

                            <button type="submit" disabled={guessResult !== null || !guess.trim()}>
                                Guess
                            </button>

                            <div className="wtp-score">
                                Score: {score}/{QUIZ_GOAL}
                            </div>

                            {guessResult === "correct" && <div className="wtp-correct">Correct!</div>}
                            {guessResult === "wrong" && <div className="wtp-wrong">Wrong Guess!</div>}
                        </form>
                    )}
                </>
            );
        }

        const canAdvance =
            mode === "free" || (guessResult === "correct" && score < QUIZ_GOAL);

        return (
            <>
                <img
                    className="wtp-artwork"
                    src={pokemon.image}
                    alt={pokemon.name}
                    onClick={mode === "free" ? nextPokemon : undefined}
                    style={mode === "free" ? { cursor: "pointer" } : undefined}
                />

                <div className="wtp-name">
                    #{pokemon.id} {pokemon.name}
                </div>

                <div className="wtp-types">
                    {pokemon.types.map((t) => (
                        <span key={t} className={`wtp-type wtp-type-${t}`}>
                            {t}
                        </span>
                    ))}
                </div>

                <div className="wtp-description">{pokemon.description}</div>

                <div className="wtp-stats">
                    <span>H: {pokemon.height} m</span>
                    <span>W: {pokemon.weight} kg</span>
                </div>

                {mode === "quiz" && guessResult === "correct" && (
                    <div className="wtp-correct">Correct! Score: {score}/{QUIZ_GOAL}</div>
                )}
                {mode === "quiz" && guessResult === "wrong" && (
                    <div className="wtp-wrong">It was {pokemon.name}!</div>
                )}

                {mode === "quiz" && canAdvance && (
                    <button className="wtp-next" onClick={nextPokemon}>
                        Next Pokémon →
                    </button>
                )}
            </>
        );
    };

    return (
        <main className="wtp-page">
            <div className="wtp">
                <div className="wtp-header">
                    <div className="wtp-light" />
                    <div className="wtp-small-lights">
                        <div className="wtp-red" />
                        <div className="wtp-yellow" />
                        <div className="wtp-green" />
                    </div>
                </div>

                <div className="wtp-screen">
                    <div className={`wtp-flash ${flash ? "active" : ""}`} />
                    {renderScreen()}
                </div>

                {phase === "playing" && (
                    <div className="wtp-controls">
                        {mode === "quiz" ? (
                            <div className="wtp-region">🌎 {pokemon?.region ?? "All Regions"}</div>
                        ) : (
                            <select
                                aria-label="Generation"
                                value={generation}
                                onChange={(e) => changeGeneration(Number(e.target.value))}
                            >
                                <option value={ANY_GEN}>All Generations</option>
                                {REGIONS.map((r) => (
                                    <option key={r.gen} value={r.gen}>
                                        Gen {r.gen} ({r.name})
                                    </option>
                                ))}
                            </select>
                        )}

                        {mode === "free" && (
                            <button onClick={nextPokemon} disabled={loading}>
                                Generate
                            </button>
                        )}

                        <button className="wtp-menu" onClick={goHome}>
                            Menu
                        </button>
                    </div>
                )}
            </div>
        </main>
    );
}
