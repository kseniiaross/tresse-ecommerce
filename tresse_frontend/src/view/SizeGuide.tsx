import { useState } from "react";
import "../../styles/SizeGuide.css";

import measureImage from "../assets/images/measure.webp";

type TabKey = "sweaters" | "swimwear";

type SweaterSizeRow = {
	label: string;
	small: string;
	medium: string;
	large: string;
};

type SwimwearSizeRow = {
	label: string;
	small: string;
	medium: string;
	large: string;
};

const SWEATER_SIZE_ROWS: SweaterSizeRow[] = [
	{
		label: "To Fit Bust",
		small: "80–88 cm / 31.5–34.5 in",
		medium: "88–96 cm / 34.5–37.8 in",
		large: "96–104 cm / 37.8–41.0 in",
	},
	{
		label: "To Fit Waist",
		small: "62–70 cm / 24.4–27.5 in",
		medium: "70–78 cm / 27.5–30.7 in",
		large: "78–86 cm / 30.7–33.8 in",
	},
	{
		label: "Product Length",
		small: "55 cm / 21.6 in",
		medium: "57 cm / 22.4 in",
		large: "59 cm / 23.2 in",
	},
	{
		label: "Sleeve Length",
		small: "60 cm / 23.6 in",
		medium: "61 cm / 24.0 in",
		large: "62 cm / 24.4 in",
	},
];

const SWIMWEAR_SIZE_ROWS: SwimwearSizeRow[] = [
	{
		label: "Bust",
		small: "70–80 cm / 27.6–31.5 in",
		medium: "81–95 cm / 31.9–37.4 in",
		large: "96–104 cm / 37.8–41.0 in",
	},
	{
		label: "Waist",
		small: "65–80 cm / 25.6–31.5 in",
		medium: "81–95 cm / 31.9–37.4 in",
		large: "96–104 cm / 37.8–41.0 in",
	},
	{
		label: "Hips",
		small: "70–80 cm / 27.6–31.5 in",
		medium: "81–90 cm / 31.9–35.4 in",
		large: "91–100 cm / 35.8–39.4 in",
	},
];

export default function SizeGuide() {
	const [activeTab, setActiveTab] = useState<TabKey>("sweaters");

	return (
		<section className="sizeGuide">
			<header>
				<h1 className="sizeGuide__title">Size Guide</h1>
				<p className="sizeGuide__subtitle">
					Use the guide below to measure your body and choose the best fit.
				</p>
			</header>

			<div
				className="sizeGuide__tabs"
				role="tablist"
				aria-label="Size guide categories"
			>
				<button
					type="button"
					className={`sizeGuide__tab ${activeTab === "sweaters" ? "is-active" : ""}`}
					onClick={() => setActiveTab("sweaters")}
				>
					Sweaters
				</button>

				<button
					type="button"
					className={`sizeGuide__tab ${activeTab === "swimwear" ? "is-active" : ""}`}
					onClick={() => setActiveTab("swimwear")}
				>
					Swimwear
				</button>
			</div>

			{activeTab === "sweaters" ? (
				<>
					<div className="sizeGuide__block sizeGuide__block--visual">
						<div className="sizeGuide__imageWrap">
							<img
								className="sizeGuide__image"
								src={measureImage}
								alt="Body measuring guide showing bust, waist and hips"
								loading="lazy"
								decoding="async"
							/>
						</div>

						<div className="sizeGuide__measureContent">
							<h2 className="sizeGuide__heading">Sweaters Measuring Guide</h2>

							<div className="sizeGuide__measure">
								<h3 className="sizeGuide__measureTitle">A. Bust / Chest</h3>
								<p className="sizeGuide__text">
									Measure around the fullest part of your chest, keeping the
									tape horizontal.
								</p>
							</div>

							<div className="sizeGuide__measure">
								<h3 className="sizeGuide__measureTitle">B. Waist</h3>
								<p className="sizeGuide__text">
									Measure around your natural waistline, the narrowest part of
									your torso.
								</p>
							</div>

							<div className="sizeGuide__measure">
								<h3 className="sizeGuide__measureTitle">C. Hips</h3>
								<p className="sizeGuide__text">
									Measure around the fullest part of your hips.
								</p>
							</div>
						</div>
					</div>

					<div className="sizeGuide__block">
						<h2 className="sizeGuide__heading">Sweaters Size Chart</h2>

						<div className="sizeGuide__tableWrap">
							<table className="sizeGuide__table">
								<thead>
									<tr>
										<th scope="col">Measurement</th>
										<th scope="col">S (Small)</th>
										<th scope="col">M (Medium)</th>
										<th scope="col">L (Large)</th>
									</tr>
								</thead>
								<tbody>
									{SWEATER_SIZE_ROWS.map((row) => (
										<tr key={row.label}>
											<th scope="row">{row.label}</th>
											<td>{row.small}</td>
											<td>{row.medium}</td>
											<td>{row.large}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>

					<div className="sizeGuide__block">
						<h2 className="sizeGuide__heading">One Size Sweaters</h2>

						<p className="sizeGuide__text">
							Our One Size sweaters are designed with a relaxed, oversized fit
							that comfortably styles across Small to Large body types. Please
							check the garment measurements below:
						</p>

						<ul className="sizeGuide__list">
							<li>
								Bust (flat lay): 110–120 cm / 43.3–47.2 in, highly stretchable
							</li>
							<li>Product Length: 60 cm / 23.6 in</li>
							<li>Sleeve Length: 62 cm / 24.4 in</li>
						</ul>

						<p className="sizeGuide__footnote">
							Please note: As our items are hand-knitted, slight variations of
							1–2 cm may occur.
						</p>
					</div>
				</>
			) : (
				<>
					<div className="sizeGuide__block sizeGuide__block--visual">
						<div className="sizeGuide__imageWrap">
							<img
								className="sizeGuide__image"
								src={measureImage}
								alt="Body measuring guide showing bust, waist and hips"
								loading="lazy"
								decoding="async"
							/>
						</div>

						<div className="sizeGuide__measureContent">
							<h2 className="sizeGuide__heading">Swimwear Measuring Tips</h2>

							<ul className="sizeGuide__list">
								<li>Use a measuring tape directly on your body.</li>
								<li>
									For the most accurate results, we recommend having someone
									assist you.
								</li>
								<li>Hold the tape snug, but not tight.</li>
								<li>Ensure the tape remains straight and is not twisted.</li>
							</ul>
						</div>
					</div>

					<div className="sizeGuide__block">
						<h2 className="sizeGuide__heading">One Size Swimwear</h2>

						<p className="sizeGuide__text">
							Our swimwear is designed as <strong>One Size</strong> and is
							highly stretchable, fitting comfortably{" "}
							<strong>Small to Large</strong> body types.
						</p>

						<div className="sizeGuide__notice">
							<p className="sizeGuide__text">
								<strong>Notice:</strong> Swimwear is considered intimate
								apparel. For hygiene reasons and optimal comfort, we strongly
								recommend providing your measurements before placing an order.
							</p>
							<p className="sizeGuide__text">
								If you are unsure, feel free to contact us — we will be happy to
								assist you in finding your ideal fit.
							</p>
						</div>
					</div>

					<div className="sizeGuide__block">
						<h2 className="sizeGuide__heading">Swimwear Size Chart</h2>

						<div className="sizeGuide__tableWrap">
							<table className="sizeGuide__table">
								<thead>
									<tr>
										<th scope="col">Measurement</th>
										<th scope="col">Small</th>
										<th scope="col">Medium</th>
										<th scope="col">Large</th>
									</tr>
								</thead>
								<tbody>
									{SWIMWEAR_SIZE_ROWS.map((row) => (
										<tr key={row.label}>
											<th scope="row">{row.label}</th>
											<td>{row.small}</td>
											<td>{row.medium}</td>
											<td>{row.large}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</>
			)}
		</section>
	);
}
