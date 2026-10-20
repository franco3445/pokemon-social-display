/**
 * PokeAPI access for the "Who's That Pokémon?" game.
 *
 * Every lookup is cached by National Dex number, the /pokemon and
 * /pokemon-species requests run in parallel, and the next Pokémon (plus its
 * artwork) can be prefetched so "Next" is effectively instant.
 */

export type Pokemon = {
    id: number;
    /** English display name, e.g. "Mr. Mime", "Nidoran♀". */
    name: string;
    /** Every spelling accepted as a correct guess, already normalised. */
    answers: string[];
    image: string;
    types: string[];
    /** Metres. */
    height: number;
    /** Kilograms. */
    weight: number;
    description: string;
    region: string;
    cry: string | null;
};

export type Region = {
    gen: number;
    name: string;
    range: [number, number];
};

export const REGIONS: Region[] = [
    { gen: 1, name: "Kanto", range: [1, 151] },
    { gen: 2, name: "Johto", range: [152, 251] },
    { gen: 3, name: "Hoenn", range: [252, 386] },
    { gen: 4, name: "Sinnoh", range: [387, 493] },
    { gen: 5, name: "Unova", range: [494, 649] },
    { gen: 6, name: "Kalos", range: [650, 721] },
    { gen: 7, name: "Alola", range: [722, 809] },
    { gen: 8, name: "Galar", range: [810, 905] },
    { gen: 9, name: "Paldea", range: [906, 1025] },
];

export const ALL_RANGE: [number, number] = [1, 1025];

const API = "https://pokeapi.co/api/v2";

export function regionFor(id: number): string {
    return REGIONS.find((r) => id <= r.range[1])?.name ?? "Unknown";
}

export function rangeForGen(gen: number): [number, number] {
    return REGIONS.find((r) => r.gen === gen)?.range ?? REGIONS[0].range;
}

/** Random id in [min, max], avoiding `exclude` when the range allows it. */
export function randomId([min, max]: [number, number], exclude?: number): number {
    if (max <= min) return min;
    let id: number;
    do {
        id = Math.floor(Math.random() * (max - min + 1)) + min;
    } while (id === exclude);
    return id;
}

/** Lowercase, strip accents and punctuation, so "Farfetch’d" == "farfetchd". */
export function normalizeName(value: string): string {
    return value
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/♀/g, "f")
        .replace(/♂/g, "m")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

function titleCase(slug: string): string {
    return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Flavor text comes with form feeds, hard line breaks and soft hyphens. */
function cleanFlavor(text: string): string {
    return text
        .replace(/­\n/g, "")
        .replace(/[\f\n\r­]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

type NamedRef = { name: string };

type PokemonResponse = {
    height: number;
    weight: number;
    types: { type: NamedRef }[];
    cries?: { latest?: string | null; legacy?: string | null };
    sprites: {
        front_default: string | null;
        other?: { "official-artwork"?: { front_default: string | null } };
    };
};

type SpeciesResponse = {
    name: string;
    names: { name: string; language: NamedRef }[];
    flavor_text_entries: { flavor_text: string; language: NamedRef }[];
};

async function getJson<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
    return res.json() as Promise<T>;
}

const cache = new Map<number, Promise<Pokemon>>();

async function load(id: number): Promise<Pokemon> {
    const [data, species] = await Promise.all([
        getJson<PokemonResponse>(`${API}/pokemon/${id}`),
        getJson<SpeciesResponse>(`${API}/pokemon-species/${id}`),
    ]);

    const name =
        species.names.find((n) => n.language.name === "en")?.name ??
        titleCase(species.name);

    const flavor = species.flavor_text_entries.find(
        (entry) => entry.language.name === "en",
    );

    const image =
        data.sprites.other?.["official-artwork"]?.front_default ??
        data.sprites.front_default ??
        "";

    return {
        id,
        name,
        answers: [...new Set([normalizeName(name), normalizeName(species.name)])],
        image,
        types: data.types.map((t) => t.type.name),
        height: data.height / 10,
        weight: data.weight / 10,
        description: flavor ? cleanFlavor(flavor.flavor_text) : "No description available.",
        region: regionFor(id),
        cry: data.cries?.latest ?? data.cries?.legacy ?? null,
    };
}

/** Warm the browser cache for an image so it renders without a pop-in. */
function preloadImage(src: string): Promise<void> {
    if (!src) return Promise.resolve();
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = img.onerror = () => resolve();
        img.src = src;
    });
}

/** Cached fetch of a Pokémon; failures are evicted so they can be retried. */
export function getPokemon(id: number): Promise<Pokemon> {
    let pending = cache.get(id);
    if (!pending) {
        pending = load(id).then(async (p) => {
            await preloadImage(p.image);
            return p;
        });
        pending.catch(() => cache.delete(id));
        cache.set(id, pending);
    }
    return pending;
}
