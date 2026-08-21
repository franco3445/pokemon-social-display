import Panel from "../components/Panel";
import { paymentPanels } from "../data/panels";

export default function Payments() {
    return (
        <main className="page">

            <div className="page-heading">

                <div className="pokedex-label">
                    PAYMENT DATABASE
                </div>

                <h1>
                    READY TO TRADE?
                </h1>

                <p>
                    Scan your preferred payment method.
                </p>

            </div>

            <div className="panel-grid">

                {paymentPanels.map((panel) => (
                    <Panel
                        key={panel.platform}
                        {...panel}
                    />
                ))}

            </div>

        </main>
    );
}