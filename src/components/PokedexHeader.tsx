import { Link } from "react-router-dom";

export default function PokedexHeader() {
    return (
        <header className="pokedex-header">

            <div className="pokedex-light">
                <div className="light-glow" />
            </div>

            <div className="header-screen">
                <div className="header-title">
                    <span>POKÉDEX</span>
                    <span className="header-subtitle">
            TRAINER CONNECTION SYSTEM
          </span>
                </div>
            </div>

            <nav className="pokedex-nav">
                <Link to="/">HOME</Link>
                <Link to="/socials">SOCIAL</Link>
                <Link to="/payments">PAY</Link>
                <Link to="/display">DISPLAY</Link>
            </nav>

        </header>
    );
}