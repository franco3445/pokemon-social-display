import { socialPanels, paymentPanels } from "../data/panels";

export default function Settings() {

    return (
        <main className="page settings-page">

            <div className="page-heading">

                <div className="pokedex-label">
                    TRAINER SETTINGS
                </div>

                <h1>
                    CONNECTION DATA
                </h1>

            </div>

            <div className="settings-card">

                <h2>Social Media</h2>

                {socialPanels.map((panel) => (
                    <div
                        className="setting-row"
                        key={panel.platform}
                    >

                        <strong>
                            {panel.platform.toUpperCase()}
                        </strong>

                        <span>
              {panel.name}
            </span>

                        <span>
              {panel.followers.toLocaleString()}
                            {" "}
                            followers
            </span>

                    </div>
                ))}

            </div>

            <div className="settings-card">

                <h2>Payment Methods</h2>

                {paymentPanels.map((panel) => (
                    <div
                        className="setting-row"
                        key={panel.platform}
                    >

                        <strong>
                            {panel.platform.toUpperCase()}
                        </strong>

                        <span>
              {panel.name}
            </span>

                    </div>
                ))}

            </div>

        </main>
    );
}