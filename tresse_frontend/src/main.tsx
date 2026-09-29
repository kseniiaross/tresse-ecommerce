import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import App from "./App";
import { setOnUnauthorized } from "./api/axiosInstance";
import { store } from "./store";
import { setCount } from "./store/wishListSlice";
import "./index.css";
import "@fontsource/cormorant-garamond/400.css";
import "@fontsource/cormorant-garamond/600.css";

setOnUnauthorized(() => {
	store.dispatch(setCount(0));
});

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<Provider store={store}>
			<App />
		</Provider>
	</React.StrictMode>,
);
