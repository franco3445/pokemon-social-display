import Panel from "../components/Panel";
import { useSocialPanels } from "../data/panels";

export default function Socials() {
    const socialPanels = useSocialPanels();

    return (
        <main className="page">

            <div className="page-heading">

                <div className="pokedex-label">
                    SOCIAL DATABASE
                </div>

                <h1>
                    FOLLOW THE TRAINER
                </h1>

                <p>
                    Scan a QR code to connect with us.
                </p>

            </div>

            <div className="panel-grid">

                {socialPanels.map((panel) => (
                    <Panel
                        key={panel.platform}
                        {...panel}
                    />
                ))}

            </div>

        </main>
    );
}