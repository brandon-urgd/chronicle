#![allow(unused_imports)]

pub mod entry;
pub mod program;
pub mod goal;
pub mod project;
pub mod scheduled;
pub mod export;
pub mod settings;
pub mod common;

// Re-export commonly used types for convenience.
// These are available for external consumers (MCP, tests, future modules).
pub use entry::{
    AttachmentResponse, CreateEntry, EntryResponse, LinkResponse, TagResponse, UpdateEntry,
};
pub use program::{
    CreateProgram, ProgramMetrics, ProgramProgressLogResponse, ProgramResponse, UpdateProgram,
};
pub use goal::{
    CreateGoal, GoalProgressLogResponse, GoalResponse, UpdateGoal,
};
pub use project::{
    CreateProject, ProjectProgressLogResponse, ProjectResponse,
    UpdateProject,
};
pub use scheduled::{
    CreateScheduledItem, ScheduledInstanceResponse, ScheduledItemResponse, UpdateScheduledItem,
};
pub use export::{
    DataExportResponse, DataImportResponse, DataValidateResponse, ExportRequest, ExportResponse,
    ImportRequest, ModularReportSections,
};
pub use settings::{
    DataLocationRequest, DataLocationResponse, SetupStatusResponse, SettingsResponse,
    UpdateSettings,
};
pub use common::{
    BackupInfo, CompleteRequest, CreateLesson, CreateLink, CreatePrepNote, CreateReportDraft,
    CreateReportPreset, CreateReviewNote, CreateReviewSession, CreateStakeholder, CreateTag,
    DashboardResponse, DueTodayResponse, ErrorResponse, HeatmapEntry, HeatmapResponse,
    IdResponse, PrepNoteResponse, ProgressLogCreate, QueryRequest, QueryResponse,
    ReportDraftResponse, ReportPresetResponse, ReviewNoteResponse, ReviewSessionResponse,
    SkipRequest, StakeholderSummaryResponse, UpdateLesson, UpdateReportDraft, UpdateReportPreset,
    UpdateStakeholder, UpdateTag, VersionResponse,
};
