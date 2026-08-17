import { useMemo, useState } from "react";
import "../../styles/FAQ.css";

type FAQItem = {
	id: string;
	category: "Orders" | "Shipping" | "Returns" | "Product" | "Care" | "Payments";
	question: string;
	answer: string;
};

function Chevron({ open }: { open: boolean }) {
	return (
		<span
			aria-hidden="true"
			style={{
				display: "inline-block",
				transform: open ? "rotate(180deg)" : "rotate(0deg)",
				transition: "transform 160ms ease",
				lineHeight: 1,
			}}
		>
			▾
		</span>
	);
}

export default function FAQ() {
	const items = useMemo<FAQItem[]>(
		() => [
			// ORDERS
			{
				id: "order-1",
				category: "Orders",
				question: "Can I change or cancel my order?",
				answer:
					"If your order hasn’t been started yet, we can usually update or cancel it. Please contact support as soon as possible with your order number.",
			},
			{
				id: "order-2",
				category: "Orders",
				question: "Do I need an account to place an order?",
				answer:
					"Yes. An account is required to place an order. You can browse products and add items to your cart without an account, but you’ll need to sign in or create one to complete your purchase. This helps us securely process payments, manage orders, and provide order history and support.",
			},
			{
				id: "order-3",
				category: "Orders",
				question: "How do I track my order?",
				answer:
					"Once your order ships, you’ll receive a confirmation email with a tracking link. You can also track it from your account if you checked out while logged in.",
			},

			// SHIPPING
			{
				id: "ship-1",
				category: "Shipping",
				question: "Where do you ship?",
				answer:
					"We ship worldwide. Delivery options and final shipping costs are displayed at checkout based on your location.",
			},
			{
				id: "ship-2",
				category: "Shipping",
				question: "How long does delivery take?",
				answer:
					"Delivery time depends on your country and shipping method. After dispatch, standard delivery typically takes 3–10 business days, and express delivery is usually faster.",
			},
			{
				id: "ship-3",
				category: "Shipping",
				question: "Will I pay duties or customs fees?",
				answer:
					"For international orders, local duties and taxes may apply. These fees are set by your country and are not controlled by us.",
			},
			{
				id: "ship-4",
				category: "Shipping",
				question: "My package says delivered, but I don’t have it. What now?",
				answer:
					"Please check with neighbors, building reception, or your local carrier first. If you still can’t locate it, contact support and we’ll help you file a trace.",
			},

			// RETURNS
			{
				id: "ret-1",
				category: "Returns",
				question: "What is your return policy?",
				answer:
					"You can request a return within 14 days of delivery for unworn items in original condition. Some limited pieces may be final sale if stated on the product page.",
			},
			{
				id: "ret-2",
				category: "Returns",
				question: "How do I start a return?",
				answer:
					"Contact support with your order number and the item(s) you want to return. We’ll send you the next steps and the return instructions.",
			},
			{
				id: "ret-3",
				category: "Returns",
				question: "When will I get my refund?",
				answer:
					"Refunds are processed after we receive and inspect the return. Depending on your bank, it may take 3–10 business days to appear on your statement.",
			},
			{
				id: "ret-4",
				category: "Returns",
				question: "Can I exchange an item?",
				answer:
					"If you need a different size or color, the fastest option is usually to return the original item and place a new order. If your piece is limited, contact support first.",
			},

			// PRODUCT
			{
				id: "prod-1",
				category: "Product",
				question: "Are your items handmade?",
				answer:
					"Yes. Our knitwear is handmade with attention to detail and finish. You may notice small variations — that’s part of the craft, not a defect.",
			},
			{
				id: "prod-2",
				category: "Product",
				question: "How do I choose the right size?",
				answer:
					"Use the Size Guide for measurements and fit notes. If you’re between sizes, choose based on your preferred fit (closer or more relaxed).",
			},
			{
				id: "prod-3",
				category: "Product",
				question: "Will an item restock?",
				answer:
					"Some pieces restock, others are limited. If a product page has a ‘back in stock’ option, you can subscribe for an email notification.",
			},

			// CARE
			{
				id: "care-1",
				category: "Care",
				question: "How should I wash knitwear?",
				answer:
					"We recommend gentle hand wash in cold water or a delicate cycle (if your machine supports it). Lay flat to dry. Avoid high heat and tumble drying.",
			},
			{
				id: "care-2",
				category: "Care",
				question: "How do I prevent pilling?",
				answer:
					"Pilling can happen naturally with knitwear. To reduce it, avoid friction (bags, rough coats) and use a fabric comb or sweater shaver gently when needed.",
			},
			{
				id: "care-3",
				category: "Care",
				question: "How should I store knitwear?",
				answer:
					"Fold and store flat to keep the shape. Hanging knitwear can stretch it over time, especially with heavier pieces.",
			},

			// PAYMENTS
			{
				id: "pay-1",
				category: "Payments",
				question: "What payment methods do you accept?",
				answer:
					"We accept major cards. If additional methods (like Apple Pay) are available, you’ll see them at checkout.",
			},
			{
				id: "pay-2",
				category: "Payments",
				question: "Is my payment information secure?",
				answer:
					"Yes. Payment is processed securely via a trusted payment provider. We do not store your full card details on our servers.",
			},
		],
		[],
	);

	const categories = useMemo(() => {
		const order: FAQItem["category"][] = [
			"Orders",
			"Shipping",
			"Returns",
			"Product",
			"Care",
			"Payments",
		];
		return order.filter((c) => items.some((i) => i.category === c));
	}, [items]);

	const [activeCategory, setActiveCategory] =
		useState<FAQItem["category"]>("Shipping");

	const _initialOpenId = useMemo(() => {
		return items.find((i) => i.category === activeCategory)?.id ?? null;
	}, [items, activeCategory]);

	const [openId, setOpenId] = useState<string | null>(
		items.find((i) => i.category === "Shipping")?.id ?? null,
	);

	const visible = useMemo(
		() => items.filter((i) => i.category === activeCategory),
		[items, activeCategory],
	);

	// IDs for tab accessibility
	const tabListLabel = "FAQ categories";
	const tabPanelId = `faq-panel-${activeCategory.toLowerCase()}`;

	return (
		<main className="faq" aria-label="FAQ page">
			<header className="faq__header">
				<h1 className="faq__title">FAQ</h1>
				<p className="faq__subtitle">
					Quick answers to the most common questions about orders, delivery,
					returns, and care.
				</p>
			</header>

			<section className="faq__layout">
				{/* Categories as tabs (a11y-friendly, still same UI) */}
				<aside className="faq__sidebar" aria-label={tabListLabel}>
					<div
						className="faq__categories"
						role="tablist"
						aria-label={tabListLabel}
					>
						{categories.map((c) => {
							const isActive = c === activeCategory;
							const tabId = `faq-tab-${c.toLowerCase()}`;

							return (
								<button
									key={c}
									id={tabId}
									type="button"
									role="tab"
									className={`faq__categoryBtn ${isActive ? "is-active" : ""}`}
									aria-selected={isActive}
									aria-controls={tabPanelId}
									tabIndex={isActive ? 0 : -1}
									onClick={() => {
										setActiveCategory(c);

										const first =
											items.find((i) => i.category === c)?.id ?? null;
										setOpenId(first);
									}}
								>
									{c}
								</button>
							);
						})}
					</div>
				</aside>

				{/* Tab panel */}
				<section
					className="faq__content"
					role="tabpanel"
					id={tabPanelId}
					aria-label={`${activeCategory} questions`}
				>
					<div className="faq__list">
						{visible.map((item) => {
							const open = openId === item.id;
							const panelId = `${item.id}-panel`;
							const btnId = `${item.id}-btn`;

							return (
								<div
									key={item.id}
									className={`faq__item ${open ? "is-open" : ""}`}
								>
									<button
										id={btnId}
										className="faq__question"
										type="button"
										aria-expanded={open}
										aria-controls={panelId}
										onClick={() => setOpenId(open ? null : item.id)}
									>
										<span className="faq__qText">{item.question}</span>
										<Chevron open={open} />
									</button>

									<section
										id={panelId}
										aria-labelledby={btnId}
										className="faq__answerWrap"
										hidden={!open}
									>
										<div className="faq__answer">{item.answer}</div>
									</section>
								</div>
							);
						})}
					</div>

					<div className="faq__help">
						<h2 className="faq__helpTitle">Still need help?</h2>
						<p className="faq__helpText">
							Write to us and we’ll respond as soon as possible.
						</p>
						<a
							className="faq__helpLink"
							href="mailto:support@tresseknitting.com"
						>
							support@tresseknitting.com
						</a>
					</div>
				</section>
			</section>
		</main>
	);
}
