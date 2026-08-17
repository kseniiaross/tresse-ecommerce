import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { clearAuthStorage, isAuthenticated } from "../types/token";
import { logout } from "../utils/authSlice";
import { useAppDispatch, useAppSelector } from "../utils/hooks";

import "../../styles/Header.css";

import api from "../api/axiosInstance";
import searchIconBlack from "../assets/icons/search-icon-black.png";
import searchIconWhite from "../assets/icons/search-icon-white.png";
import { clearServerCart } from "../store/serverCartSlice";
import { setCount } from "../store/wishListSlice";
import {
	clearCart as clearGuestCart,
	selectGuestCartCount,
} from "../utils/cartSlice";

type SearchProduct = {
	id: number;
	name: string;
	price?: string | number;
	images?: Array<{ image: string }>;
	in_stock?: boolean;
};

const Header: React.FC = () => {
	const dispatch = useAppDispatch();
	const navigate = useNavigate();
	const location = useLocation();

	const [hovered, setHovered] = useState(false);
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const [isCompact, setIsCompact] = useState(() => window.innerWidth <= 768);
	const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

	const userMenuWrapRef = useRef<HTMLDivElement | null>(null);
	const sidebarRef = useRef<HTMLElement | null>(null);
	const sidebarBackdropRef = useRef<HTMLDivElement | null>(null);

	const [query, setQuery] = useState("");
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [isSearchLoading, setIsSearchLoading] = useState(false);
	const [searchError, setSearchError] = useState<string | null>(null);
	const [results, setResults] = useState<SearchProduct[]>([]);
	const searchWrapRef = useRef<HTMLDivElement | null>(null);

	const user = useAppSelector((state) => state.auth.user);
	const isAuthed = isAuthenticated();

	const serverCart = useAppSelector((s) => s.serverCart.cart);
	const serverItems = serverCart?.items ?? [];
	const serverCount = serverItems.reduce((sum, it) => sum + it.quantity, 0);
	const guestCount = useAppSelector(selectGuestCartCount);
	const cartCount = isAuthed ? serverCount : guestCount;

	const isDarkText = location.pathname !== "/";
	const searchIcon = isDarkText ? searchIconBlack : searchIconWhite;

	const menuId = "user-dropdown-menu";
	const sidebarId = "category-menu";
	const searchListId = "header-search-suggestions";

	useEffect(() => {
		const handleResize = () => {
			setIsCompact(window.innerWidth <= 768);
		};

		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, []);

	useEffect(() => {
		const onClickOutside = (e: MouseEvent) => {
			if (!isUserMenuOpen) return;

			const target = e.target as Node;

			if (
				userMenuWrapRef.current &&
				!userMenuWrapRef.current.contains(target)
			) {
				setIsUserMenuOpen(false);
			}
		};

		document.addEventListener("mousedown", onClickOutside);
		return () => document.removeEventListener("mousedown", onClickOutside);
	}, [isUserMenuOpen]);

	useEffect(() => {
		const onClickOutside = (e: MouseEvent) => {
			if (!isSearchOpen) return;

			const target = e.target as Node;

			if (searchWrapRef.current && !searchWrapRef.current.contains(target)) {
				setIsSearchOpen(false);
			}
		};

		document.addEventListener("mousedown", onClickOutside);
		return () => document.removeEventListener("mousedown", onClickOutside);
	}, [isSearchOpen]);

	useEffect(() => {
		setIsUserMenuOpen(false);
		setIsSearchOpen(false);
		setIsMenuOpen(false);
		setHovered(false);
	}, []);

	useEffect(() => {
		if (!isMenuOpen) return;

		window.setTimeout(() => sidebarRef.current?.focus(), 0);

		// Close when the click starts on the backdrop itself, not the sidebar
		// (attached imperatively so the backdrop stays a plain, non-interactive
		// element for assistive tech; Escape and the close button are the
		// keyboard-equivalent ways to close the menu).
		const onBackdropClick = (e: MouseEvent) => {
			if (e.target === sidebarBackdropRef.current) setIsMenuOpen(false);
		};
		sidebarBackdropRef.current?.addEventListener("click", onBackdropClick);

		return () => {
			sidebarBackdropRef.current?.removeEventListener("click", onBackdropClick);
		};
	}, [isMenuOpen]);

	const trimmed = useMemo(() => query.trim(), [query]);

	useEffect(() => {
		if (!trimmed || trimmed.length < 2) {
			setResults([]);
			setSearchError(null);
			setIsSearchOpen(false);
			return;
		}

		setIsSearchLoading(true);
		setSearchError(null);

		const timer = window.setTimeout(async () => {
			try {
				const res = await api.get("/products/", {
					params: { search: trimmed, page_size: 6 },
				});

				const list: SearchProduct[] = res.data?.results ?? res.data ?? [];

				setResults(Array.isArray(list) ? list : []);
				setIsSearchOpen(true);
			} catch {
				setResults([]);
				setSearchError("Search is temporarily unavailable.");
				setIsSearchOpen(true);
			} finally {
				setIsSearchLoading(false);
			}
		}, 250);

		return () => window.clearTimeout(timer);
	}, [trimmed]);

	const toggleMenu = () => setIsMenuOpen((prev) => !prev);
	const closeMenu = () => setIsMenuOpen(false);

	const handleLogout = () => {
		clearAuthStorage();

		dispatch(logout());
		dispatch(clearServerCart());
		dispatch(setCount(0));
		dispatch(clearGuestCart());

		localStorage.setItem("wishlist:ping", String(Date.now()));
		navigate("/");
	};

	const openSearch = () => {
		if (trimmed.length >= 2) setIsSearchOpen(true);
	};

	const submitSearchToCatalog = () => {
		const q = query.trim();

		if (!q) return;

		setIsSearchOpen(false);
		navigate(`/catalog?search=${encodeURIComponent(q)}`);
	};

	const goToProduct = (productId: number) => {
		setIsSearchOpen(false);
		setQuery("");
		navigate(`/product/${productId}`);
	};

	const getFirstImage = (p: SearchProduct) => p.images?.[0]?.image || "";

	const goToSidebarSearch = () => {
		closeMenu();
		navigate("/catalog?focusSearch=1");
	};

	return (
		<header className="header">
			<div className="left-section">
				<button
					type="button"
					className={`hamburger ${hovered ? "hover-animate" : ""}`}
					onClick={toggleMenu}
					onMouseEnter={() => setHovered(true)}
					onMouseLeave={() => setHovered(false)}
					aria-label="Toggle category menu"
					aria-expanded={isMenuOpen}
					aria-controls={sidebarId}
				>
					<span className={`bar top ${isDarkText ? "dark" : ""}`} />
					<span className={`bar middle ${isDarkText ? "dark" : ""}`} />
					<span className={`bar bottom ${isDarkText ? "dark" : ""}`} />
				</button>

				<Link
					to="/"
					className={`logo ${isDarkText ? "dark" : ""}`}
					aria-label="Go to homepage"
				>
					T R E S S E
				</Link>
			</div>

			<div className="right-section">
				{isCompact ? (
					<button
						type="button"
						className="search-icon-btn"
						aria-label="Search products"
						onClick={() => navigate("/catalog?focusSearch=1")}
					>
						<img src={searchIcon} alt="" className="search-icon" />
					</button>
				) : (
					<div className="header-search" ref={searchWrapRef}>
						<label className="srOnly" htmlFor="site-search">
							Search
						</label>

						<input
							id="site-search"
							type="text"
							placeholder="SEARCH"
							className={`search-input ${isDarkText ? "dark" : ""}`}
							aria-label="Search products"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							onFocus={openSearch}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									submitSearchToCatalog();
								}

								if (e.key === "Escape") {
									setIsSearchOpen(false);
								}
							}}
							role="combobox"
							aria-autocomplete="list"
							aria-haspopup="listbox"
							aria-expanded={isSearchOpen}
							aria-controls={searchListId}
							autoComplete="off"
						/>

						{(isSearchOpen || isSearchLoading) && (
							<div
								id={searchListId}
								className="search-dropdown"
								role="listbox"
								aria-label="Search suggestions"
							>
								{isSearchLoading ? (
									<div className="search-dropdown__row search-dropdown__muted">
										Searching…
									</div>
								) : null}

								{!isSearchLoading && searchError ? (
									<div className="search-dropdown__row search-dropdown__error">
										{searchError}
									</div>
								) : null}

								{!isSearchLoading &&
								!searchError &&
								trimmed.length >= 2 &&
								results.length === 0 ? (
									<div className="search-dropdown__row search-dropdown__muted">
										No matches
									</div>
								) : null}

								{!isSearchLoading && !searchError
									? results.map((p) => {
											const img = getFirstImage(p);

											return (
												<button
													key={p.id}
													type="button"
													className="search-dropdown__item"
													role="option"
													onClick={() => goToProduct(p.id)}
												>
													<span className="search-dropdown__thumb">
														{img ? <img src={img} alt="" /> : null}
													</span>

													<span className="search-dropdown__text">
														<span className="search-dropdown__name">
															{p.name}
														</span>

														{typeof p.in_stock === "boolean" ? (
															<span className="search-dropdown__meta">
																{p.in_stock ? "Available" : "Out of stock"}
															</span>
														) : null}
													</span>
												</button>
											);
										})
									: null}

								{!isSearchLoading && !searchError && results.length > 0 ? (
									<button
										type="button"
										className="search-dropdown__all"
										onClick={submitSearchToCatalog}
									>
										View all results
									</button>
								) : null}
							</div>
						)}
					</div>
				)}

				{user ? (
					<div className="user-menu-wrap" ref={userMenuWrapRef}>
						<button
							type="button"
							className={`user-menu__btn ${isDarkText ? "dark" : ""}`}
							aria-haspopup="menu"
							aria-expanded={isUserMenuOpen}
							aria-controls={menuId}
							onClick={() => setIsUserMenuOpen((v) => !v)}
							onKeyDown={(e) => e.key === "Escape" && setIsUserMenuOpen(false)}
						>
							{String(user.first_name || "").toUpperCase()}
							<span className="user-menu__caret" aria-hidden>
								▾
							</span>
						</button>

						{isUserMenuOpen ? (
							<div id={menuId} className="user-menu" role="menu">
								<Link
									to="/dashboard"
									className="user-menu__item"
									role="menuitem"
								>
									PROFILE
								</Link>

								<Link
									to="/wishlist"
									className="user-menu__item"
									role="menuitem"
								>
									WISHLIST
								</Link>

								<Link to="/orders" className="user-menu__item" role="menuitem">
									ORDERS
								</Link>

								<button
									type="button"
									className="user-menu__item user-menu__logout"
									role="menuitem"
									onClick={handleLogout}
								>
									LOG OUT
								</button>
							</div>
						) : null}
					</div>
				) : (
					<Link
						to="/login-choice"
						className={`login-button ${isDarkText ? "dark" : ""}`}
					>
						LOG IN
					</Link>
				)}

				<Link to="/help" className={`help-button ${isDarkText ? "dark" : ""}`}>
					HELP
				</Link>

				<Link to="/cart" className={`shopping-bag ${isDarkText ? "dark" : ""}`}>
					SHOPPING BAG [{cartCount}]
				</Link>
			</div>

			{isMenuOpen ? (
				<div className="sidebar-backdrop" ref={sidebarBackdropRef}>
					<aside
						id={sidebarId}
						ref={sidebarRef}
						className="sidebar-menu"
						role="dialog"
						aria-label="Category menu"
						tabIndex={-1}
						onKeyDown={(e) => {
							if (e.key === "Escape") closeMenu();
						}}
					>
						<button
							type="button"
							className="sidebar-menu__close"
							onClick={closeMenu}
							aria-label="Close menu"
						>
							×
						</button>

						<div className="sidebar-menu__brand">TRESSE</div>

						<nav className="menu-content" aria-label="Categories">
							<ul>
								<li>
									<Link to="/catalog?category=woman" onClick={closeMenu}>
										WOMAN
									</Link>

									<div className="menu-content__sub">
										<Link
											to="/catalog?category=woman&collection=summer"
											onClick={closeMenu}
										>
											SUMMER
										</Link>
										<Link
											to="/catalog?category=woman&collection=sweaters"
											onClick={closeMenu}
										>
											SWEATERS
										</Link>
										<Link
											to="/catalog?category=woman&collection=cardigans"
											onClick={closeMenu}
										>
											CARDIGANS
										</Link>
										<Link
											to="/catalog?category=woman&collection=dresses"
											onClick={closeMenu}
										>
											DRESSES
										</Link>
									</div>
								</li>

								<li>
									<Link to="/catalog?category=man" onClick={closeMenu}>
										MAN
									</Link>
								</li>

								<li>
									<Link to="/catalog?category=kids" onClick={closeMenu}>
										KIDS
									</Link>
								</li>

								<li>
									<Link to="/catalog?collection=the-new" onClick={closeMenu}>
										THE NEW
									</Link>
								</li>

								<li>
									<Link
										to="/catalog?collection=bestsellers"
										onClick={closeMenu}
									>
										BESTSELLERS
									</Link>
								</li>

								<li>
									<Link to="/catalog?collection=exclusives" onClick={closeMenu}>
										EXCLUSIVES
									</Link>
								</li>
							</ul>
						</nav>

						<div className="sidebar-menu__bottom">
							<div className="sidebar-menu__actions">
								<button type="button" onClick={goToSidebarSearch}>
									<span className="sidebar-menu__icon sidebar-menu__icon--search" />
									SEARCH
								</button>

								<Link
									to={user ? "/dashboard" : "/login-choice"}
									className="account-link"
									onClick={closeMenu}
								>
									<span className="sidebar-menu__icon sidebar-menu__icon--account" />
									MY ACCOUNT
								</Link>

								<Link to="/help" onClick={closeMenu}>
									<span className="sidebar-menu__icon sidebar-menu__icon--help" />
									HELP
								</Link>
							</div>

							<div className="sidebar-menu__locale">
								ENGLISH <span /> USD ($)
							</div>
						</div>
					</aside>
				</div>
			) : null}
		</header>
	);
};

export default Header;
