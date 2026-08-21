import { Link } from "react-router-dom";
import { useSocialPanels, paymentPanels } from "../data/panels";
import Panel from "../components/Panel";

export default function Home() {
    const socialPanels = useSocialPanels();

    return (
        <main className="page">

            <section className="hero">

                <div className="hero-pokeball">
                    <div className="pokeball-top" />
                    <div className="pokeball-bottom" />
                    <div className="pokeball-center" />
                </div>

                <div>
                    <h1>
                        TRAINER
                        <br />
                        CONNECTION
                    </h1>

                    <p>
                        FOLLOW THE JOURNEY.
                        <br />
                        SCAN & CONNECT.
                    </p>
                </div>

            </section>

            <section className="quick-actions">

                <Link to="/socials" className="action-button">
                    SOCIAL MEDIA
                </Link>

                <Link to="/payments" className="action-button">
                    PAYMENT
                </Link>

                <Link to="/display" className="action-button">
                    FULL DISPLAY
                </Link>

            </section>

            <section className="preview-section">

                <h2 className="section-title">
                    SOCIAL MEDIA
                </h2>

                <div className="panel-grid">

                    {socialPanels.map((panel) => (
                        <Panel
                            key={panel.platform}
                            {...panel}
                        />
                    ))}

                </div>

            </section>

            <section className="preview-section">

                <h2 className="section-title">
                    PAYMENT CENTER
                </h2>

                <div className="panel-grid">

                    {paymentPanels.map((panel) => (
                        <Panel
                            key={panel.platform}
                            {...panel}
                        />
                    ))}

                </div>

            </section>

        </main>
    );
}