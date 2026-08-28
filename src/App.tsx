import {
  BrowserRouter,
  Routes,
  Route,
} from "react-router-dom";

import PokedexHeader from "./components/PokedexHeader";
import BouncingPokeball from "./components/BouncingPokeball";

import Home from "./pages/Home";
import Socials from "./pages/Socials";
import Payments from "./pages/Payments";
import Settings from "./pages/Settings";
import Display from "./pages/Display";

function App() {

  return (
      <BrowserRouter>

        <PokedexHeader />

        <BouncingPokeball />

        <Routes>

          <Route
              path="/"
              element={<Home />}
          />

          <Route
              path="/socials"
              element={<Socials />}
          />

          <Route
              path="/payments"
              element={<Payments />}
          />

          <Route
              path="/settings"
              element={<Settings />}
          />

          <Route
              path="/display"
              element={<Display />}
          />

        </Routes>

      </BrowserRouter>
  );
}

export default App;