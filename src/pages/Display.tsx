import Panel from "../components/Panel";
import {
    socialPanels,
    paymentPanels,
} from "../data/panels";

export default function Display() {

    const panels = [
        ...socialPanels,
        ...paymentPanels,
    ];

    return (
        <main className="display-page">

            <div className="display-header">

                <div className="display-title">
                    <span>POKÉDEX</span>
                    <small>
                        TRAINER CONNECTION CENTER
                    </small>
                </div>

                <div className="display-status">
                    ONLINE ●
                </div>

            </div>

            <div className="display-grid">

                {panels.map((panel) => (
                    <Panel
                        key={panel.platform}
                        {...panel}
                    />
                ))}

            </div>

            <div className="display-footer">

        <span>
          SCAN • CONNECT • TRADE
        </span>

                <span>
          Gotta Catch 'Em All!
        </span>

            </div>

        </main>
    );
}