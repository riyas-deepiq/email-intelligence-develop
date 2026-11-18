# Graph Report - .  (2026-07-15)

## Corpus Check
- Large corpus: 402 files · ~2,628,102 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 3091 nodes · 6851 edges · 231 communities (145 shown, 86 thin omitted)
- Extraction: 96% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 231 edges (avg confidence: 0.78)
- Token cost: 135,805 input · 0 output

## Community Hubs (Navigation)
- Auth Middleware & Guards
- Audit Log API
- Chat Controller & Sessions
- Users Table UI
- Drizzle DB Schema
- RAG Ingestion Core Classes
- User Repository
- Alerts & Sidebar UI
- Auth Provider Repository
- Threads View UI
- DB Config & Migrations
- Google Client Integration
- Org Hierarchy Controller
- Permission Catalog & Roles
- Auth Controller
- Roles View UI
- JWT Token Signing
- Server App Bootstrap
- Audit Repository
- Dashboard View & Auth Hook
- Google Connection Form UI
- Password Reset & Setup UI
- Auth API Client
- SSO Settings UI
- App Shell & Static Pages
- RAG DB CRUD (Python)
- Attachments View UI
- Mail Connector Interface
- Collector Parsing Utilities
- Server NPM Dependencies
- Mock Dashboard Data
- Chart Components
- Server Dev Dependencies
- Audit Service
- Chat API Client
- RAG FastAPI App Bootstrap
- RAG Prompt/Context Builder
- Server Error Types
- Org Hierarchy API & View
- Client TS Config
- Qdrant Setup & RBAC Filters
- Org Repository
- Mailboxes View UI
- Collector API Client
- System Architecture Overview (Docs)
- Email Parsing & Chunking (RAG)
- Embedding Layer (Ollama/Nomic)
- Reports API Client
- Client TS Config (Build)
- RAG Ingestion Pipeline
- Session Store
- Client TS Config (App)
- Admin API Client
- Login View UI
- Emails View UI
- Collector Job Processor
- Mailboxes API & View
- Organizations View UI
- Postgres Mailbox Repository
- DB Retry Utilities
- Collector Architecture (Docs)
- Batch Embedding Pipeline
- Email Notification Templates
- Role Controller
- Alerts API & View
- Monitoring API & View
- Google Connector (Gmail)
- Architecture Docs (RAG/API)
- RAG API Models (Pydantic)
- Alert Controller
- Client Dev Dependencies
- Settings View UI
- Server Dev Dependencies (Build)
- Connector Types & Tests
- Mailbox Repository & Schema
- Mailbox Controller
- User Controller
- RAG Settings Config
- App Shell UI
- RAG Generation & Storage (Docs)
- Design Docs (API/DB/Security)
- Auth Provider Config (Docs)
- Database Table Docs
- RAG Query Endpoint
- Infra & Data Layer (Docs)
- Attachment Parsers (RAG)
- Auth Service & Device Name
- Attachment Download Service
- In-Memory Mailbox Repository
- API Endpoint Reference (Docs)
- Server NPM Scripts
- Collector Service Architecture
- RAG DB & Concurrency Design
- Server Middleware Stack
- Dashboard Routes
- Server Build TS Config
- RAG Ingest Endpoints
- RAG Layer Architecture (Docs)
- Auth Provider Controller
- Mailbox Photo Repository
- Client Build TS Config
- Audit Log View UI
- Ollama LLM Client
- Collector NPM Scripts
- React App Entry & Error Boundary
- Collector NPM Dependencies
- RAG/Python Scripts
- System Actors & Security (Docs)
- Eml Parser & Tests
- Retrieval Tests (RAG)
- Collector Security & Job States (Docs)
- Client Core Dependencies
- M365 Connector Tests
- Postgres Email Source (RAG)
- Chat & RBAC Cross-Service Flow (Docs)
- Audit Controller
- Model Serving & Sessions (Docs)
- Provider Connection Controller
- RAG Health Check Script
- Client Entry & Build Setup
- Package Manifest
- Org Reporting-Chain Authorization (Docs)
- Retrieval & Vector Store Layer (Docs)
- RAG API Tests
- Package Manifest (Collector)
- Prettier Config
- Prettier Config (Client)
- RAG Prompt Templates
- Prettier Config (Server)
- Package Manifest (RAG)
- Auth Onboarding Flows (Docs)
- Identity Provider Icons
- Platform Principles (Docs)
- Chevron Icons
- Register View UI
- Vite Env Types
- Architecture Doc Index
- Risk Register & Summarization (Docs)
- Auth & Governance (Docs)
- ESLint Plugin Dependency
- React Hooks Lint Plugin
- Globals Package
- jsdom Test Environment
- Prettier Package
- Testing Library jest-dom
- React Type Definitions
- React DOM Type Definitions
- TypeScript Package
- Vitest Package (Client)
- Vitest Coverage Package
- ESLint Package
- Supertest Package
- Express Type Definitions
- TS ESLint Plugin
- TS ESLint Parser (Server)
- Vitest Package (Server)
- Onboarding Flow (Docs)
- Dedup & Sync Model (Docs)
- Retrieval Design (Docs)
- Infrastructure Design (Docs)
- Redis Docker Service
- ESLint Prettier Config Package
- Prettier Package (Collector)
- tsx Runtime Package
- TS ESLint Parser (Collector)
- Vitest Package (Collector)
- Admin Gear Icon
- Alert Triangle Icon
- Paperclip Icon
- Audit Clipboard Icon
- Bell Icon
- Brand Logo Illustration
- Checkmark Icon
- Clock Icon
- Database Icon
- Departments Icon
- Eye Icon
- Eye Off Icon
- Lightning Bolt Icon
- Google Logo Icon
- Home Icon
- Info Icon
- App Logo Icon
- Logout Icon
- Mail Icon
- Mailbox Icon
- Plus Icon
- Save Icon
- Search Icon
- Settings Icon
- Shield Icon
- Threads Icon
- Users Icon
- MiPhi AI Node (Docs)
- IdP Config Table
- Policies Table
- Compliance Posture (Docs)
- OIDC/SAML SSO (Docs)
- JWT Sessions (Docs)
- Auth Provider Configuration (Docs)
- Deployment Prerequisites (Docs)
- Development Roadmap Doc
- Auth Providers Table (Docs)
- Sample Contact Email
- Sample Attachment Test Data
- Sample Employee ID
- Sample Join Date
- Sample Employee Name
- Sample Org Name
- Sample Job Title
- Onboarding Graphic Asset
- Qdrant Docker Service
- Docker Compose Infra
- pdfminer.six Package
- Pillow Package
- RAG Requirements Manifest
- pydantic-settings Package
- pypdf Package
- Redis Python Client
- Uvicorn Package

## God Nodes (most connected - your core abstractions)
1. `getDb()` - 103 edges
2. `AuditService` - 42 edges
3. `User` - 39 edges
4. `useAuth()` - 36 edges
5. `MailboxRepository` - 34 edges
6. `AuditActor` - 33 edges
7. `useToast()` - 32 edges
8. `actorFromRequest()` - 31 edges
9. `OrgRepository` - 29 edges
10. `logger` - 28 edges

## Surprising Connections (you probably didn't know these)
- `RolesView()` --indirect_call--> `mailbox()`  [INFERRED]
  client/src/features/dashboard/views/RolesView.tsx → collector/tests/m365-connector.test.ts
- `MinIO raw storage (Phase 1)` --semantically_similar_to--> `MinIO (S3-compatible object store)`  [INFERRED] [semantically similar]
  collector/README.md → README.md
- `RabbitMQ job queue (Phase 1)` --semantically_similar_to--> `RabbitMQ (broker)`  [INFERRED] [semantically similar]
  collector/README.md → README.md
- `BGE-M3 (target embedding model)` --conceptually_related_to--> `nomic-embed-text (embedding model)`  [AMBIGUOUS]
  README.md → RAG/README.md
- `Qwen2.5-Instruct (target production LLM)` --conceptually_related_to--> `llama3.2 (default OLLAMA_MODEL)`  [AMBIGUOUS]
  README.md → RAG/README.md

## Import Cycles
- 1-file cycle: `RAG/vector_store/qdrant_client.py -> RAG/vector_store/qdrant_client.py`

## Hyperedges (group relationships)
- **Mailbox Ingestion Pipeline (Admin -> Server API -> Collector -> Mail Provider -> Postgres)** — docs_02_system_design_admin, docs_02_system_design_server_api, docs_02_system_design_collector, docs_02_system_design_mail_provider, docs_02_system_design_postgresql [EXTRACTED 1.00]
- **Grounded Query Pipeline (ACL Filter -> Hybrid Retrieval -> Rerank -> Generation -> Guardrails)** — docs_02_system_design_acl_filter, docs_02_system_design_qdrant, docs_02_system_design_retrieval_design, docs_02_system_design_miphi_model, docs_02_system_design_fenced_data_defense [EXTRACTED 1.00]
- **PostgreSQL Relational Schema (live + planned tables)** — docs_04_database_design_users_table, docs_04_database_design_org_nodes_table, docs_04_database_design_mailboxes_table, docs_04_database_design_ingestion_jobs_table, docs_04_database_design_messages_table, docs_04_database_design_threads_table, docs_04_database_design_summaries_table, docs_04_database_design_audit_log_table, docs_04_database_design_organizations_table, docs_04_database_design_auth_providers_table, docs_04_database_design_sessions_table [EXTRACTED 1.00]
- **Auth Provider Icon Set** — client_src_assets_icons_idp_icon, client_src_assets_icons_keycloak_icon, client_src_assets_icons_microsoft_icon, client_src_assets_icons_okta_icon [INFERRED 0.85]
- **Competing/evolving choices for the production LLM role across project docs** — readme_qwen2_5, rag_diagram_mistral_7b, rag_diagram_gemma3_4b, rag_readme_llama3_2 [INFERRED 0.65]
- **Ingestion pipeline flow: EmlParser to AttachmentParser to Chunker to Embedder to Qdrant** — rag_diagram_eml_parser_class, rag_diagram_attachment_parser_class, rag_diagram_email_chunker_class, rag_diagram_nomic_embedder_class, rag_diagram_email_qdrant_client_class [EXTRACTED 1.00]
- **RAG's 7-layer architecture (ingestion, embedding, vector_store, retrieval, llm, db, api)** — rag_readme_ingestion_layer, rag_readme_embedding_layer, rag_readme_vector_store_layer, rag_readme_retrieval_layer, rag_readme_llm_layer, rag_readme_db_layer, rag_readme_api_layer [EXTRACTED 1.00]

## Communities (231 total, 86 thin omitted)

### Community 0 - "Auth Middleware & Guards"
Cohesion: 0.05
Nodes (71): asyncHandler(), verifyAccessToken(), requireAuth(), requireRole(), userRepo, createAuditRepository(), auditRouter, auditSvc (+63 more)

### Community 1 - "Audit Log API"
Cohesion: 0.06
Nodes (57): AuditLogEntry, AuditQueryParams, AuditQueryResult, queryAuditLog(), asRecord(), AUDIT_CATEGORIES, AUDIT_EVENT_LABELS, auditCategory (+49 more)

### Community 2 - "Chat Controller & Sessions"
Cohesion: 0.08
Nodes (28): chatMessages, chatSessions, ChatController, QueryBody, RagStreamEvent, ChatRepository, createChatRepository(), InMemoryChatRepository (+20 more)

### Community 3 - "Users Table UI"
Cohesion: 0.05
Nodes (41): react, ROLE_VARIANT, STATUS_LABEL, STATUS_VARIANT, AsyncState(), AsyncStateProps, Avatar(), AvatarProps (+33 more)

### Community 4 - "Drizzle DB Schema"
Cohesion: 0.05
Nodes (56): AlertRow, alertSeverityEnum, AttachmentRow, auditLog, AuthProviderRow, authProviders, authProviderTypeEnum, ChatCitation (+48 more)

### Community 5 - "RAG Ingestion Core Classes"
Cohesion: 0.05
Nodes (50): AttachmentParser class, BatchEmbedder class, context_builder.py (build_rag_prompt / build_summary_prompt), data/eml/*.eml (legacy bulk folder ingestion source), EmailChunker class, EmailContext dataclass, EmailQdrantClient class, routes/emails.py (+42 more)

### Community 6 - "User Repository"
Cohesion: 0.11
Nodes (11): users, InMemoryUserRepository, PgUserRepository, toUser(), toUserWithHash(), UserRepository, makeRepo(), makeUser() (+3 more)

### Community 7 - "Alerts & Sidebar UI"
Cohesion: 0.07
Nodes (23): listAlerts(), markAllAlertsRead(), ProviderBanner(), NAV_ENTRIES, NavEntry, NavItem, Sidebar(), SidebarProps (+15 more)

### Community 8 - "Auth Provider Repository"
Cohesion: 0.13
Nodes (14): encrypt(), AuthProviderRepository, InMemoryAuthProviderRepository, makeDefaultProviders(), PgAuthProviderRepository, toAuthProvider(), AuthProviderService, VALID_DISCOVERY (+6 more)

### Community 9 - "Threads View UI"
Cohesion: 0.08
Nodes (40): ADMIN_THREAD_COLUMNS, BROWSE_PAGE_SIZES, extOf(), fmtDate(), fmtDateTime(), fmtSize(), IMPORTANCE_TONES, MAILBOX_THREADS_PAGE_COLUMNS (+32 more)

### Community 10 - "DB Config & Migrations"
Cohesion: 0.11
Nodes (18): config, checkDbConnection(), closeDb(), ensureDatabase(), runMigrations(), seedAuthProviders(), seedSuperAdmin(), logger (+10 more)

### Community 11 - "Google Client Integration"
Cohesion: 0.09
Nodes (25): parseDataUri(), buildAdminClient(), fetchGooglePhoto(), GoogleTestResult, GoogleUser, listAllGoogleUsers(), testGoogleConnection(), fetchUserPhoto() (+17 more)

### Community 12 - "Org Hierarchy Controller"
Cohesion: 0.11
Nodes (12): OrgHierarchyController, parseAddBody(), parseUpdateBody(), OrgHierarchyRepository, PgOrgHierarchyRepository, toIso(), toOrgNode(), OrgHierarchyService (+4 more)

### Community 13 - "Permission Catalog & Roles"
Cohesion: 0.10
Nodes (21): roles, ADMIN_PERMISSIONS, EMPLOYEE_PERMISSIONS, PERMISSION_CATALOG, PermissionCatalogItem, InMemoryRoleRepository, PgRoleRepository, RoleRepository (+13 more)

### Community 14 - "Auth Controller"
Cohesion: 0.08
Nodes (23): AuthController, clearRefreshCookie(), extractRefreshToken(), setRefreshCookie(), AcceptInviteDto, Body, ChangePasswordDto, ForgotPasswordDto (+15 more)

### Community 15 - "Roles View UI"
Cohesion: 0.13
Nodes (29): UsersTableProps, DEFAULT_DRAFT, groupPermissions(), hasAssignedRole(), listAllMailboxes(), MailboxAssignee, mailboxAssigneeSecondary(), roleDisplayName() (+21 more)

### Community 16 - "JWT Token Signing"
Cohesion: 0.13
Nodes (12): newSessionId(), JwtPayload, signAccessToken(), signRefreshToken(), verifyRefreshToken(), AuthService, TokenPair, IdTokenPayload (+4 more)

### Community 17 - "Server App Bootstrap"
Cohesion: 0.10
Nodes (16): createApp(), HealthState, Env, envSchema, parsed, ClaimedJob, JobType, logger (+8 more)

### Community 18 - "Audit Repository"
Cohesion: 0.14
Nodes (12): AuditRepository, InMemoryAuditRepository, buildConditions(), PgAuditRepository, toEntry(), SENSITIVE_KEYS, actor, SpyAuditRepository (+4 more)

### Community 19 - "Dashboard View & Auth Hook"
Cohesion: 0.12
Nodes (23): useAuth(), ADMIN_ONLY_VIEWS, ServiceStatus, VALID_VIEWS, VIEW_META, Dashboard(), renderView(), AdminConsoleView() (+15 more)

### Community 20 - "Google Connection Form UI"
Cohesion: 0.10
Nodes (25): ConnectionTestResult(), Props, GoogleForm(), GoogleFormValues, Props, M365Form(), M365FormValues, Props (+17 more)

### Community 21 - "Password Reset & Setup UI"
Cohesion: 0.12
Nodes (23): forgotPassword(), resetPassword(), setupOrg(), ForgotPassword(), ResetPassword(), pwStrength(), Setup(), STEPS (+15 more)

### Community 22 - "Auth API Client"
Cohesion: 0.13
Nodes (24): acceptInvite(), completeOidcFlow(), exchangeOidcCode(), fetchMe(), logoutApi(), AuthResponse, LoginPayload, MeResponse (+16 more)

### Community 23 - "SSO Settings UI"
Cohesion: 0.10
Nodes (26): JitProvisioningCard(), SsoSettingsView(), AuthProviderRow, ConnectorStatus, disconnectOidcProvider(), extractTenantId(), fetchAuthProviders(), fetchJitConfig() (+18 more)

### Community 24 - "App Shell & Static Pages"
Cohesion: 0.09
Nodes (17): AppLayout(), FULLSCREEN_PATHS, About(), Contact(), TODO: wire to contact API, Footer(), Navbar(), Props (+9 more)

### Community 25 - "RAG DB CRUD (Python)"
Cohesion: 0.11
Nodes (22): DeclarativeBase, get_department_by_name(), get_sync_cursor(), get_user_by_email(), get_user_by_id(), list_users(), datetime, Session (+14 more)

### Community 26 - "Attachments View UI"
Cohesion: 0.12
Nodes (27): AttachmentDetailsWizard(), AttachmentPreview, AttachmentsView(), extOf(), FILE_COLUMNS, FILE_TYPES, fmtDate(), fmtDateTime() (+19 more)

### Community 27 - "Mail Connector Interface"
Cohesion: 0.15
Nodes (15): MailConnector, MailboxRef, MessageStream, ProbeResult, getAccessToken(), graphFetchJson(), GraphPage, M365Connector (+7 more)

### Community 28 - "Collector Parsing Utilities"
Cohesion: 0.14
Nodes (22): RFC-5987, attachments, mailboxes, messages, parseDateParam(), htmlToText(), QUOTE_PATTERNS, stripQuotedReply() (+14 more)

### Community 29 - "Server NPM Dependencies"
Cohesion: 0.07
Nodes (29): argon2, cors, drizzle-orm, express-rate-limit, helmet, ioredis, jsonwebtoken, nodemailer (+21 more)

### Community 30 - "Mock Dashboard Data"
Cohesion: 0.07
Nodes (28): MOCK_ACTIVITIES, MOCK_AI_SUMMARY_KPIS, MOCK_ALERTS, MOCK_ATTACHMENTS, MOCK_AUDIT_LOGS, MOCK_DASH_STATS, MOCK_DEPARTMENTS, MOCK_EMAILS (+20 more)

### Community 31 - "Chart Components"
Cohesion: 0.10
Nodes (15): AreaChart(), AreaChartProps, ChartRow, BarRow, BarRows(), BarRowsProps, ConcentricRingChart(), ConcentricRingChartProps (+7 more)

### Community 32 - "Server Dev Dependencies"
Cohesion: 0.07
Nodes (29): drizzle-kit, devDependencies, drizzle-kit, eslint, pino-pretty, supertest, @types/cors, @types/express (+21 more)

### Community 33 - "Audit Service"
Cohesion: 0.18
Nodes (5): AuditService, AuditActor, AuditEventType, RoleService, RoleDefinition

### Community 34 - "Chat API Client"
Cohesion: 0.13
Nodes (16): getDocumentLink(), getSession(), listSessions(), postQueryStream(), refreshAccessToken(), streamHeaders(), ChatMessage, ChatSession (+8 more)

### Community 35 - "RAG FastAPI App Bootstrap"
Cohesion: 0.11
Nodes (18): FastAPI, lifespan(), Initialise resources on startup, release on shutdown., get_settings(), db_session(), get_db(), init_db(), Session (+10 more)

### Community 36 - "RAG Prompt/Context Builder"
Cohesion: 0.12
Nodes (18): _get_reranker(), _get_search(), build_rag_prompt(), build_summary_prompt(), EmailContext, Build a prompt asking the LLM to summarise the given contexts., A single retrieved chunk ready for LLM prompt construction., Assemble a structured RAG prompt from retrieved contexts.      Format:         ═ (+10 more)

### Community 37 - "Server Error Types"
Cohesion: 0.13
Nodes (13): AppError, ConflictError, ForbiddenError, NotFoundError, ServiceUnavailableError, UnauthorizedError, ValidationError, hashPassword() (+5 more)

### Community 38 - "Org Hierarchy API & View"
Cohesion: 0.12
Nodes (19): addOrgNode(), listOrgNodes(), OrgNodeDto, removeOrgNode(), updateOrgNode(), AddNodeModalProps, buildTree(), EditDrawer() (+11 more)

### Community 39 - "Client TS Config"
Cohesion: 0.08
Nodes (25): compilerOptions, esModuleInterop, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+17 more)

### Community 40 - "Qdrant Setup & RBAC Filters"
Cohesion: 0.09
Nodes (16): main(), EmailQdrantClient, get_qdrant_client(), Filter, QdrantClient, Dense vector search against a collection.          Args:             query_vecto, Build a Qdrant Filter based on RBAC role.          Roles:           executive, Build a Qdrant Filter restricting results to a specific set of mailbox         I (+8 more)

### Community 41 - "Org Repository"
Cohesion: 0.22
Nodes (9): InMemoryOrgRepository, OrgRepository, PgOrgRepository, toOrg(), CreateOrgInput, Org, SkippableStep, UpdateJitConfigInput (+1 more)

### Community 42 - "Mailboxes View UI"
Cohesion: 0.13
Nodes (20): DrawerProps, MAILBOX_COLUMNS, MAILBOX_PAGE_SIZES, MailboxDrawer(), MailboxesView(), PROBE_LABEL, PROBE_VARIANT, renderMailboxCell() (+12 more)

### Community 43 - "Collector API Client"
Cohesion: 0.13
Nodes (17): ApiError, apiFetch(), authHeader(), claimJobs(), getJobToken(), getSyncSchedule(), JobStats, JobToken (+9 more)

### Community 44 - "System Architecture Overview (Docs)"
Cohesion: 0.10
Nodes (25): AI Service (Python / FastAPI), Audit Writer, Chunking + Embedding (BGE-M3), Core Server (Node + TS), Document Parsing (unstructured + Apache Tika), Identity Provider (Azure AD / Google / Okta), Language Detection, Principle: The LLM is never the security boundary (+17 more)

### Community 45 - "Email Parsing & Chunking (RAG)"
Cohesion: 0.11
Nodes (18): Message, Estimate token count using tiktoken cl100k_base., _token_len(), _decode_header(), _extract_addresses(), _extract_attachments(), _extract_thread_id(), _get_body_parts() (+10 more)

### Community 46 - "Embedding Layer (Ollama/Nomic)"
Cohesion: 0.11
Nodes (12): get_embedder(), NomicEmbedder, Embed a single document chunk (adds search_document prefix)., Embed a user search query (adds search_query prefix)., Embed a list of document texts in batches.          Args:             texts:, Returns True if Ollama is reachable., POST to Ollama /api/embed and return embeddings list., Return the shared NomicEmbedder singleton, initialising on first call. (+4 more)

### Community 47 - "Reports API Client"
Cohesion: 0.12
Nodes (19): getReportsData(), ReportsBarRow, ReportsData, ReportsKpi, ReportsPeriod, ReportsSentimentSlice, ReportsVolumePoint, csvCell() (+11 more)

### Community 48 - "Client TS Config (Build)"
Cohesion: 0.08
Nodes (23): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, noFallthroughCasesInSwitch, noImplicitOverride (+15 more)

### Community 49 - "RAG Ingestion Pipeline"
Cohesion: 0.12
Nodes (16): EmailChunker, Splits parsed email content into embedding-ready TextChunks., ParsedEmail, IngestionPipeline, datetime, Ingest a single .eml file., Ingest messages straight from the Core Server's Postgres `messages`         tabl, Process one email: chunk, embed, upsert. Returns points count. (+8 more)

### Community 50 - "Session Store"
Cohesion: 0.09
Nodes (7): MemorySessionStore, SessionStore, MailboxRepository, SetupService, SetupStatus, SetupStep, SetupStepKey

### Community 51 - "Client TS Config (App)"
Cohesion: 0.08
Nodes (23): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, noFallthroughCasesInSwitch, noImplicitOverride (+15 more)

### Community 52 - "Admin API Client"
Cohesion: 0.16
Nodes (13): createOrgNode(), deleteOrgNode(), getOrgTree(), updateOrgNode(), ConnectMailboxPayload, IdpConfig, Mailbox, MeteringRecord (+5 more)

### Community 53 - "Login View UI"
Cohesion: 0.13
Nodes (12): fetchEnabledProviders(), login(), Login(), ThemeDropdownBtn(), readStoredTheme(), resolveTheme(), Theme, ThemeContext (+4 more)

### Community 54 - "Emails View UI"
Cohesion: 0.13
Nodes (20): DateRange, DateRangeFilter(), accessibleName(), EmailsView(), extOf(), fmtDate(), fmtDateTime(), IMPORTANCE_TONES (+12 more)

### Community 55 - "Collector Job Processor"
Cohesion: 0.18
Nodes (11): buildConnector(), drainStream(), processJob(), runImportJob(), runMailboxScanJob(), runSyncRangeExtensionJob(), updateJob(), MessageBuffer (+3 more)

### Community 56 - "Mailboxes API & View"
Cohesion: 0.14
Nodes (12): connectMailbox(), listMailboxes(), listSyncJobs(), startSync(), Mailboxes(), formatDuration(), SyncDashboard(), Spinner() (+4 more)

### Community 57 - "Organizations View UI"
Cohesion: 0.15
Nodes (15): ORG_COLUMNS, OrgsView(), OrganizationsSection(), getOrg(), ColumnFilterMenu(), ColumnFilterMenuPagination, ColumnFilterMenuPaginationToggle, ColumnFilterMenuProps (+7 more)

### Community 58 - "Postgres Mailbox Repository"
Cohesion: 0.18
Nodes (4): getDb(), PgMailboxRepository, toMailbox(), CollectorService

### Community 59 - "DB Retry Utilities"
Cohesion: 0.19
Nodes (12): collectErrorChain(), delay(), ErrorLike, isTransientDbConnectionError(), TRANSIENT_DB_CODES, TRANSIENT_DB_MESSAGE_PATTERNS, withDbRetry(), PgSessionStore (+4 more)

### Community 60 - "Collector Architecture (Docs)"
Cohesion: 0.12
Nodes (20): Connectors (Microsoft Graph, Google Workspace), Dedup (Message-ID + content hash), Google Workspace Gmail API, Principle: Idempotent ingestion, Microsoft 365 Graph API, Probe (Node + TS, ingestion), RabbitMQ, Redis (+12 more)

### Community 61 - "Batch Embedding Pipeline"
Cohesion: 0.13
Nodes (12): BatchEmbedder, Wraps NomicEmbedder to process lists of TextChunk objects.      Attaches embeddi, Generate embeddings for a list of TextChunks (in-place).          Each chunk rec, Embed chunks and log progress (useful for large batches)., _get_splitter(), Chunk the plain-text body of a ParsedEmail.          Args:             parsed_em, Chunk extracted attachment text.          Args:             text:         Extrac, Very simple HTML tag stripping without BeautifulSoup dependency. (+4 more)

### Community 62 - "Email Notification Templates"
Cohesion: 0.35
Nodes (19): esc(), infoRow(), infoTable(), p(), securityNote(), sendAccountDeactivatedEmail(), sendAccountReactivatedEmail(), sendInviteEmail() (+11 more)

### Community 63 - "Role Controller"
Cohesion: 0.21
Nodes (10): actorFromRequest(), knownPermissionIds(), RoleController, BASE_ROLES, parseAssignUserRoleDto(), parseCreateRoleDto(), parseUpdateRoleDto(), readBaseRole() (+2 more)

### Community 64 - "Alerts API & View"
Cohesion: 0.17
Nodes (15): Alert, AlertSeverity, markAlertRead(), AlertDetailDrawer(), AlertsView(), exactTime(), fmtFull(), SEV_FILTERS (+7 more)

### Community 65 - "Monitoring API & View"
Cohesion: 0.15
Nodes (16): CollectorHealth, ConnectorHealth, FailedPoint, getMonitoringData(), MonitoringData, MonitoringKpi, ServiceHealth, VolPoint (+8 more)

### Community 66 - "Google Connector (Gmail)"
Cohesion: 0.22
Nodes (10): MessagePageStream, buildGmailClient(), extractBody(), GaxiosLikeError, GoogleConnector, GoogleCredentials, parseAddressHeader(), parseHeader() (+2 more)

### Community 67 - "Architecture Docs (RAG/API)"
Cohesion: 0.11
Nodes (19): AI Service / RAG (Python+FastAPI, RAG/), BGE-M3 (target embedding model), docs/03-api-design.md, docs/01-architecture.md, docs/04-database-design.md, docs/07-deployment-guide.md, docs/06-infrastructure-design.md, docs/08-development-roadmap.md (+11 more)

### Community 68 - "RAG API Models (Pydantic)"
Cohesion: 0.19
Nodes (16): BaseModel, EmailListResponse, EmailSummary, HealthResponse, IngestPostgresRequest, IngestStatusResponse, QueryRequest, QueryResponse (+8 more)

### Community 69 - "Alert Controller"
Cohesion: 0.16
Nodes (6): AlertController, createAlertRepository(), AlertService, alertsRouter, alertsSvc, controller

### Community 70 - "Client Dev Dependencies"
Cohesion: 0.12
Nodes (17): devDependencies, eslint, eslint-plugin-react-refresh, @testing-library/react, @types/node, typescript-eslint, vite, vite-plugin-svgr (+9 more)

### Community 71 - "Settings View UI"
Cohesion: 0.18
Nodes (13): changePassword(), listSessions(), revokeSession(), UsersTable(), ROLE_LABEL, SecurityTab(), SETTINGS_TABS, SettingsTab (+5 more)

### Community 72 - "Server Dev Dependencies (Build)"
Cohesion: 0.12
Nodes (17): devDependencies, eslint-config-prettier, pino-pretty, prettier, tsx, @types/node, @types/supertest, typescript (+9 more)

### Community 73 - "Connector Types & Tests"
Cohesion: 0.12
Nodes (11): EmailAddress, FetchSummary, MailProvider, bufferAdd, bufferFlush, fetchBackfillRange, fetchMailbox, getJobToken (+3 more)

### Community 74 - "Mailbox Repository & Schema"
Cohesion: 0.23
Nodes (11): MailboxRow, CreateMailboxDto, isEmail(), parseCreateMailboxDto(), PROVIDERS, MailboxProvider, MailboxStatus, MailboxSyncStatus (+3 more)

### Community 76 - "User Controller"
Cohesion: 0.20
Nodes (8): UserController, CreateUserDto, InviteUserDto, isEmail(), parseCreateUserDto(), parseInviteUserDto(), parseUpdateUserDto(), ROLES

### Community 78 - "App Shell UI"
Cohesion: 0.12
Nodes (4): AppShell(), AppShellProps, NAV_ITEMS, NavItem

### Community 79 - "RAG Generation & Storage (Docs)"
Cohesion: 0.17
Nodes (16): Generation (grounded prompt + guardrails), Prompt-injection Defense, mailboxes table, messages table, MinIO Layout (content-addressed keys), MinIO (store), Qdrant email_chunks collection, Qdrant (store) (+8 more)

### Community 80 - "Design Docs (API/DB/Security)"
Cohesion: 0.14
Nodes (16): 03 — API Design, 04 — Database Design, ingestion_jobs table, 05 — Security Design, Cross-cutting Concerns (every phase), Decision Traceability (D1-D26), Phase 0 — Foundation (complete), Phase 1 — Ingestion (in progress) (+8 more)

### Community 81 - "Auth Provider Config (Docs)"
Cohesion: 0.13
Nodes (16): auth_providers table (live), mailbox_credentials table, organizations table (live), Client Secret Encryption (AES-256-GCM), Configuration Page, Email + Password Provider, Google Workspace (OIDC) Provider, Google Workspace Setup (+8 more)

### Community 82 - "Database Table Docs"
Cohesion: 0.19
Nodes (16): Alerts Table, Attachments Table, Audit Log Table, Ingestion Jobs Table, Mailboxes Table, Messages Table, Org Closure Table, Org Nodes Table (+8 more)

### Community 83 - "RAG Query Endpoint"
Cohesion: 0.25
Nodes (14): QueryRequest, ask(), _is_greeting(), Session, Perform an access-scoped RAG query.      1. Resolve scope: trusted mailbox_ids (, Return ranked source chunks without LLM generation., Stream the LLM answer token-by-token as Server-Sent Events, followed by one, Retrieve + rerank contexts for a query.      Two scoping modes:     - mailbox_id (+6 more)

### Community 84 - "Infra & Data Layer (Docs)"
Cohesion: 0.14
Nodes (16): Redis Docker service (:6379), No SQLite fallback -- Postgres-only backend, Shared Postgres DB (Core Server + RAG), Core Server (Node+TS, server/), Permission Resolver (reporting-chain), PostgreSQL, Query Orchestrator / Audit / Metering, Redis (+ BullMQ) (+8 more)

### Community 85 - "Attachment Parsers (RAG)"
Cohesion: 0.16
Nodes (5): AttachmentParser, Parse raw attachment bytes into plain text., Args:             save_dir: If set, extracted attachment files are saved here, Extract text from a ParsedAttachment.  Returns empty string on failure., ParsedAttachment

### Community 86 - "Auth Service & Device Name"
Cohesion: 0.24
Nodes (10): getDeviceName(), Express, Request, LoginRequest, LoginResponse, SessionUser, SetupRequest, SetupResponse (+2 more)

### Community 87 - "Attachment Download Service"
Cohesion: 0.24
Nodes (15): decrypt(), AttachmentContent, AttachmentMeta, collectGmailAttachments(), downloadAttachment(), downloadGoogleAttachment(), downloadM365Attachment(), getM365Token() (+7 more)

### Community 88 - "In-Memory Mailbox Repository"
Cohesion: 0.20
Nodes (3): InMemoryMailboxRepository, CreateMailboxInput, Mailbox

### Community 89 - "API Endpoint Reference (Docs)"
Cohesion: 0.15
Nodes (15): Admin — Mailboxes & Sync Endpoints, Admin — Org Hierarchy Endpoints, Admin — Policy, Audit, Metering Endpoints, AI Service / RAG Internal API, Auth Endpoints (login/refresh/logout/me/setup), Auth Providers Config Endpoints, AuthZ Rules (enforced in Core Server), Chat API (Phase 2 — not yet implemented) (+7 more)

### Community 90 - "Server NPM Scripts"
Cohesion: 0.13
Nodes (15): scripts, build, db:generate, db:migrate, db:push, db:studio, dev, format (+7 more)

### Community 91 - "Collector Service Architecture"
Cohesion: 0.18
Nodes (13): Collector (ingestion service), DedupService, GoogleConnector (stub), IngestionService, M365Connector (stub), MailConnector interface, MinIO raw storage (Phase 1), RabbitMQ job queue (Phase 1) (+5 more)

### Community 92 - "RAG DB & Concurrency Design"
Cohesion: 0.18
Nodes (14): Thread-pool concurrency tied to OLLAMA_NUM_PARALLEL, Layer 6: DB / RBAC bookkeeping (db/), db/seed.py, Department/role-based RBAC path, Incremental ingestion cursor / fail-safe retry design, scripts/ingest_from_postgres.py, rag_departments table, rag_ingest_jobs table (+6 more)

### Community 93 - "Server Middleware Stack"
Cohesion: 0.23
Nodes (10): createApp(), errorHandler(), notFoundHandler(), REDACTED, requestLogger(), sanitize(), internalRouter, sharedMemoryRepo (+2 more)

### Community 94 - "Dashboard Routes"
Cohesion: 0.15
Nodes (12): searchQueries, topics, CHART_PERIODS, ChartPeriod, dashboardRouter, deltaMeta(), orgRepo, percentChange() (+4 more)

### Community 95 - "Server Build TS Config"
Cohesion: 0.15
Nodes (12): compilerOptions, outDir, rootDir, exclude, extends, include, coverage, dist (+4 more)

### Community 96 - "RAG Ingest Endpoints"
Cohesion: 0.19
Nodes (12): ingest_postgres(), ingest_status(), ingest_upload(), Session, Upload a single .eml file and ingest it immediately., Background task: runs IngestionPipeline against the Postgres `messages` table., Start ingesting messages directly from Postgres instead of the .eml folder., Poll the progress of an ingestion job. (+4 more)

### Community 97 - "RAG Layer Architecture (Docs)"
Cohesion: 0.17
Nodes (13): scripts/check_system.py, Layer 2: Embedding (embedding/), eml_parser.py / ingest_single() (manual .eml upload), Layer 1: Ingestion (ingestion/), llama3.2 (default OLLAMA_MODEL), Layer 5: LLM (llm/), nomic-embed-text (embedding model), Ollama (local LLM/embedding runtime) (+5 more)

### Community 98 - "Auth Provider Controller"
Cohesion: 0.26
Nodes (8): AuthProviderController, Body, isUrl(), optionalStr(), parseProviderParam(), parseUpdateAuthProviderDto(), UpdateAuthProviderDto, ALL_PROVIDERS

### Community 99 - "Mailbox Photo Repository"
Cohesion: 0.23
Nodes (4): InMemoryMailboxPhotoRepository, MailboxPhoto, MailboxPhotoRepository, PgMailboxPhotoRepository

### Community 100 - "Client Build TS Config"
Cohesion: 0.15
Nodes (12): compilerOptions, outDir, rootDir, exclude, extends, include, coverage, dist (+4 more)

### Community 101 - "Audit Log View UI"
Cohesion: 0.23
Nodes (8): listAuditEntries(), AuditEntry, AuditLog(), EVENT_TYPES, EmptyState(), EmptyStateProps, Modal(), ModalProps

### Community 102 - "Ollama LLM Client"
Cohesion: 0.20
Nodes (6): OllamaLLMClient, Pre-load the model into Ollama memory., Thin HTTP wrapper around Ollama's /api/generate endpoint.      Usage:         cl, Generate a complete response (blocking).          Args:             prompt:, Yield tokens one by one as they arrive from Ollama., Return True if the model is available in Ollama.

### Community 103 - "Collector NPM Scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, format, lint, lint:fix, preview, test (+3 more)

### Community 104 - "React App Entry & Error Boundary"
Cohesion: 0.22
Nodes (4): App(), queryClient, ErrorBoundary, State

### Community 105 - "Collector NPM Dependencies"
Cohesion: 0.18
Nodes (11): dependencies, dotenv, express, googleapis, pino, zod, dotenv, express (+3 more)

### Community 106 - "RAG/Python Scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, format, lint, lint:fix, start, test (+3 more)

### Community 107 - "System Actors & Security (Docs)"
Cohesion: 0.20
Nodes (11): ACL Filter, Admin (actor), AI Service, Core Server, Employee (actor), Fenced DATA (prompt-injection defense), MiPhi Model, PostgreSQL (+3 more)

### Community 108 - "Eml Parser & Tests"
Cohesion: 0.24
Nodes (7): EmlParser, Parse .eml files into ParsedEmail dataclasses., Parse a single .eml file.  Returns None on failure., Fallback using mail-parser library., test_parse_file_extracts_addresses(), test_parse_file_returns_parsed_email(), test_parse_nonexistent_file()

### Community 109 - "Retrieval Tests (RAG)"
Cohesion: 0.27
Nodes (9): Construct from a Qdrant ScoredPoint., make_context(), Reranker should fall back to score-based ordering if model unavailable., test_build_rag_prompt_attachment_label(), test_build_rag_prompt_contains_query(), test_build_rag_prompt_contains_source(), test_build_rag_prompt_multiple_sources(), test_email_context_from_scored_point() (+1 more)

### Community 110 - "Collector Security & Job States (Docs)"
Cohesion: 0.22
Nodes (10): Collector Internal API, COLLECTOR_SECRET, Heartbeat Mechanism, Job States (pending/claimed/running/done/failed/dead), COLLECTOR_SECRET, Collector <-> Server Security, Data Protection, Network Segmentation (+2 more)

### Community 111 - "Client Core Dependencies"
Cohesion: 0.22
Nodes (9): axios, dependencies, axios, react-dom, react-router-dom, @tanstack/react-query, react-dom, react-router-dom (+1 more)

### Community 112 - "M365 Connector Tests"
Cohesion: 0.22
Nodes (3): fetchMock, mailbox(), TOKEN_RESPONSE

### Community 113 - "Postgres Email Source (RAG)"
Cohesion: 0.31
Nodes (8): _format_addresses(), iter_messages_from_postgres(), _merge_recipients(), datetime, # NOTE: use CAST(:param AS type), not the `:param::type` shorthand — SQLAlchemy', Flatten a jsonb EmailAddress[] column (`[{"email":..,"name":..}]`) into a     co, Union of the message's own To addresses and the thread's full     participant ro, Stream messages from Postgres ordered by (updated_at, id) — stable keyset     pa

### Community 114 - "Chat & RBAC Cross-Service Flow (Docs)"
Cohesion: 0.22
Nodes (9): Layer 7: API (api/) FastAPI backend, Client chat feature (client/src/features/chat/), Core Server chat module (server/src/modules/chat/), getScopedMailboxIds() (Core Server), Mailbox-scoped RBAC path, RBAC filtering enforced inside the Qdrant query, RAG_INTERNAL_SECRET / RAG_API_SECRET shared secret, fastapi (+1 more)

### Community 115 - "Audit Controller"
Cohesion: 0.33
Nodes (6): AuditController, ENTITY_TYPES, parseOptionalDate(), parseOptionalInt(), parseOptionalString(), AuditEntityType

### Community 116 - "Model Serving & Sessions (Docs)"
Cohesion: 0.29
Nodes (8): Model Serving (MiPhi / Qwen2.5), Principle: Swappable model runtime, Redis Keys, Redis (store), Session Store Priority (Memory/Redis/Postgres fallback), sessions table (live, PgSessionStore), MiPhi Serving Abstraction, Model Adapter (OpenAI-compatible)

### Community 117 - "Provider Connection Controller"
Cohesion: 0.43
Nodes (5): ProviderConnectionController, isEmail(), isNonEmptyString(), parseConnectPayload(), parseTestPayload()

### Community 118 - "RAG Health Check Script"
Cohesion: 0.33
Nodes (6): Any, health(), check_db_connection(), Return True if the PostgreSQL connection works., check(), main()

### Community 119 - "Client Entry & Build Setup"
Cohesion: 0.33
Nodes (7): /src/main.tsx entry module, index.html root entry, Inline theme-detection script, ESLint + TypeScript config, React Compiler, React + Vite template, Web Client (React+TS, client/)

### Community 120 - "Package Manifest"
Cohesion: 0.29
Nodes (6): description, engines, node, main, name, version

### Community 121 - "Org Reporting-Chain Authorization (Docs)"
Cohesion: 0.29
Nodes (7): Reporting-chain Scope (recursive CTE), org_closure table, org_nodes table (adjacency-list org tree), Reporting-chain Scope Query (recursive CTE), users table, Reporting-chain Authorization Model, Postgres Row-Level Security (defense in depth)

### Community 122 - "Retrieval & Vector Store Layer (Docs)"
Cohesion: 0.33
Nodes (7): Qdrant collection: email_attachments, Qdrant collection: email_bodies, cross-encoder ms-marco-MiniLM-L-6-v2, Layer 4: Retrieval (retrieval/), scripts/setup_qdrant.py, Layer 3: Vector Store (vector_store/), sentence-transformers

### Community 124 - "Package Manifest (Collector)"
Cohesion: 0.29
Nodes (6): description, engines, node, main, name, version

### Community 125 - "Prettier Config"
Cohesion: 0.33
Nodes (5): printWidth, semi, singleQuote, tabWidth, trailingComma

### Community 126 - "Prettier Config (Client)"
Cohesion: 0.33
Nodes (5): printWidth, semi, singleQuote, tabWidth, trailingComma

### Community 127 - "RAG Prompt Templates"
Cohesion: 0.40
Nodes (4): build_rag_prompt(), build_summary_prompt(), Build the full RAG prompt combining system prompt + context + user question., Build a summarisation prompt.

### Community 128 - "Prettier Config (Server)"
Cohesion: 0.33
Nodes (5): printWidth, semi, singleQuote, tabWidth, trailingComma

### Community 129 - "Package Manifest (RAG)"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 130 - "Auth Onboarding Flows (Docs)"
Cohesion: 0.40
Nodes (5): Bootstrap Login (native email + password), Break-glass Super Admin Account, JIT Provisioning, OIDC SSO, Setup Wizard (3 steps)

### Community 131 - "Identity Provider Icons"
Cohesion: 1.00
Nodes (4): Identity Provider (Padlock) Icon, Keycloak Logo Icon, Microsoft Logo Icon, Okta Logo Icon

### Community 132 - "Platform Principles (Docs)"
Cohesion: 0.50
Nodes (4): Principle: Design once for the product, switch on by tier, Raynex Platform, Employee (actor), HR / Super Admin (actor)

### Community 133 - "Chevron Icons"
Cohesion: 0.67
Nodes (3): Chevron Down Icon, Chevron Left Icon, Chevron Right Icon

### Community 136 - "Architecture Doc Index"
Cohesion: 0.67
Nodes (3): 01 — Architecture, 02 — System Design, Observability

### Community 137 - "Risk Register & Summarization (Docs)"
Cohesion: 0.67
Nodes (3): Risk R5 (permission scoping), Risk R6 (cost control), Summarization Pipeline (hierarchical, incremental)

### Community 138 - "Auth & Governance (Docs)"
Cohesion: 0.67
Nodes (3): Audit & Governance, Authentication, Native Username/Password (break-glass)

## Ambiguous Edges - Review These
- `Probe (Node + TS, ingestion)` → `Collector (stateless poll-worker)`  [AMBIGUOUS]
  docs/02-system-design.md · relation: shares_data_with
- `Collector (stateless poll-worker)` → `Probe (build unit)`  [AMBIGUOUS]
  docs/07-deployment-guide.md · relation: shares_data_with
- `OIDC_ENCRYPTION_KEY env var` → `Configuration Reference (env vars)`  [AMBIGUOUS]
  docs/06-auth-provider-configuration.md · relation: shares_data_with
- `Install — Pilot/GA (k3s)` → `09 — Infrastructure Design`  [AMBIGUOUS]
  docs/07-deployment-guide.md · relation: references
- `Layer 1: Ingestion (ingestion/)` → `data/eml/*.eml (legacy bulk folder ingestion source)`  [AMBIGUOUS]
  RAG/diagram.txt · relation: conceptually_related_to
- `Layer 7: API (api/) FastAPI backend` → `ui/streamlit_app.py (Streamlit chat UI)`  [AMBIGUOUS]
  RAG/diagram.txt · relation: conceptually_related_to
- `nomic-embed-text (embedding model)` → `BGE-M3 (target embedding model)`  [AMBIGUOUS]
  README.md · relation: conceptually_related_to
- `llama3.2 (default OLLAMA_MODEL)` → `mistral:7b (production LLM, per diagram)`  [AMBIGUOUS]
  RAG/diagram.txt · relation: conceptually_related_to
- `llama3.2 (default OLLAMA_MODEL)` → `Qwen2.5-Instruct (target production LLM)`  [AMBIGUOUS]
  README.md · relation: conceptually_related_to
- `scripts/ingest_from_postgres.py` → `celery`  [AMBIGUOUS]
  RAG/requirements.txt · relation: conceptually_related_to
- `IngestionPipeline class` → `Redis Docker service (:6379)`  [AMBIGUOUS]
  RAG/diagram.txt · relation: conceptually_related_to
- `pytesseract` → `unstructured + Apache Tika / PaddleOCR (target parsing/OCR stack)`  [AMBIGUOUS]
  README.md · relation: conceptually_related_to

## Knowledge Gaps
- **761 isolated node(s):** `semi`, `singleQuote`, `trailingComma`, `printWidth`, `tabWidth` (+756 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **86 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Probe (Node + TS, ingestion)` and `Collector (stateless poll-worker)`?**
  _Edge tagged AMBIGUOUS (relation: shares_data_with) - confidence is low._
- **What is the exact relationship between `Collector (stateless poll-worker)` and `Probe (build unit)`?**
  _Edge tagged AMBIGUOUS (relation: shares_data_with) - confidence is low._
- **What is the exact relationship between `OIDC_ENCRYPTION_KEY env var` and `Configuration Reference (env vars)`?**
  _Edge tagged AMBIGUOUS (relation: shares_data_with) - confidence is low._
- **What is the exact relationship between `Install — Pilot/GA (k3s)` and `09 — Infrastructure Design`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Layer 1: Ingestion (ingestion/)` and `data/eml/*.eml (legacy bulk folder ingestion source)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Layer 7: API (api/) FastAPI backend` and `ui/streamlit_app.py (Streamlit chat UI)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `nomic-embed-text (embedding model)` and `BGE-M3 (target embedding model)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._