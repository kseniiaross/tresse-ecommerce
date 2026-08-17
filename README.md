# TRESSE Online Store

TRESSE Online Store is a modern full-stack e-commerce platform for handmade fashion products, built with a strong focus on accessibility (WCAG 2.1), performance, and real-world usability.

The application is designed as a production-ready product, combining a clean, minimal interface with scalable architecture and secure data handling. The goal is not only to present products, but to guide users through a smooth and intuitive purchasing journey — from discovery to checkout.

Live link: https://tressehandmade.com

---

## Preview

### Homepage
![Homepage](docs/preview/homepage.png)

### Email Subscribtion
![Email](docs/preview/email.png)


### Product Catalog
![Catalog](docs/preview/catalog.png)
cart
### Product Detail
![Product](docs/preview/product.png)

### Authentication
![Auth](docs/preview/auth.png)

### Cart & Checkout
![Cart](docs/preview/cart.png)
![Checkout](docs/preview/checkout.png)

---

## Key Features

- Modern full-stack fashion e-commerce platform
- Guest + authenticated cart system
- JWT authentication with automatic token refresh
- Real-time product filtering and search
- Wishlist functionality
- Product reviews and ratings
- Secure Stripe checkout integration
- Responsive and accessible UI (WCAG 2.1, Section 508)
- Scalable full-stack architecture (React + Django)

---

## Product Experience

The platform is designed around real user behavior and expectations in modern e-commerce:

- Clear product presentation with structured catalog and filtering
- Fast navigation with minimal friction between pages
- Consistent UI across all devices
- Seamless add-to-cart and checkout flow
- Interface that responds instantly to user actions with clear feedback
- Stable performance as product data grows

Each interaction is intentionally simplified to reduce cognitive load, improve usability, and increase conversion.

---

## Shopping Flow

The platform provides a complete shopping experience from product discovery to secure checkout.

Users can browse the catalog, filter products, view detailed product pages, add items to the cart, manage wishlist items, and complete purchases through Stripe.

The system supports both guest users and authenticated users, allowing customers to interact with products before creating an account. Guest cart data is stored locally, while authenticated users have their cart managed through the backend.

This approach reduces friction, improves user retention, and creates a smoother purchase journey.

---

## Catalog and Product Management

The product catalog is designed to support scalable product growth and real-world e-commerce needs.

The catalog includes:

- Product categories and structured navigation
- Product detail pages with images and descriptions
- Product availability and stock-related data
- Search and filtering functionality
- Wishlist interaction
- Product reviews and ratings

This structure allows users to discover products quickly while giving the application a flexible foundation for future catalog expansion.

---

## Technical Challenges & Solutions

**1. Guest vs authenticated cart logic**  
Implemented a dual cart system using localStorage for guest users and backend storage for authenticated users, with seamless synchronization after login.

**2. Token expiration handling**  
Prevented session interruptions by implementing Axios interceptors with automatic JWT refresh logic.

**3. Protected user flows**  
Implemented protected frontend routes for pages and actions that require authentication, while still allowing guest users to browse products and build a cart.

**4. Scalable product architecture**  
Designed the product structure to support categories, filtering, product details, wishlist functionality, reviews, ratings, and future catalog expansion.

---

## Security and Data Handling

Security is treated as a core part of the product, not an afterthought.

- Authentication is implemented using JWT (access and refresh tokens)
- Tokens are securely managed and automatically refreshed
- Sensitive operations are protected through backend validation
- Protected routes prevent unauthorized access to restricted pages
- No payment data is stored on the client side
- Payment processing is handled by Stripe (PCI-compliant)

This approach ensures that user data is protected and the system is ready for real-world usage.

---

## Performance and Reliability

The application is optimized to provide a fast and stable experience:

- Efficient state management using Redux Toolkit
- Optimized API communication through a centralized Axios instance
- Automatic token refresh without interrupting user sessions
- Clean and modular component architecture
- Production build optimized with Vite
- Responsive rendering across desktop and mobile devices

The system is designed to scale without degrading performance or user experience.

---

## Architecture

The project follows a full-stack architecture with clear separation of concerns.

### Frontend
- React with TypeScript
- Redux Toolkit for state management
- React Router for navigation
- Axios with interceptors for API handling
- Vite for fast development and optimized production builds

### Backend
- Django REST Framework
- PostgreSQL database
- Token-based authentication (JWT)
- RESTful API structure

This structure allows the product to evolve easily, supporting future features such as analytics, admin tools, marketing flows, and expanded product management.

---

## Accessibility

Accessibility is treated as a core product requirement rather than a compliance checkbox.

The platform is designed with WCAG 2.1 and Section 508 standards in mind, ensuring that users with different abilities can interact with the product without barriers.

Key accessibility considerations include:

- Semantic HTML structure for screen reader compatibility
- Full keyboard navigation support
- Proper focus management and visible focus states
- ARIA attributes to enhance assistive technology support
- High-contrast and readable UI elements
- Responsive layouts for different devices and screen sizes

Accessibility decisions are integrated into the development process from the start, improving usability for all users.

---

## Business Value

This project demonstrates the ability to build a real-world e-commerce product focused on measurable outcomes:

- Improving product discovery through structured catalog navigation
- Reducing friction in the purchase flow
- Ensuring secure handling of user data
- Building a scalable and maintainable frontend architecture
- Delivering a production-ready user experience
- Supporting real commercial features such as cart, wishlist, checkout, and authentication

The result is not a demo application, but a functional foundation for a commercial product.

---

## Author

Kseniia Rostovskaia  
Full-Stack Developer

Portfolio: https://kseniiaross.dev  
LinkedIn: https://www.linkedin.com/in/kseniia-rostovskaia
