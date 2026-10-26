namespace Patika.Domain.Entities;

public enum UserRole { User, Trusted, Moderator, Admin }
public enum StationKind { Food, Water, Both }
public enum Species { Cat, Dog, Mixed }
public enum StationStatus { Active, NeedsRefill, Removed }
public enum AnimalSex { Unknown, Female, Male }
public enum AnimalStatus { Healthy, Injured, Missing, Adopted, Deceased }
public enum ModerationState { Pending, Approved, Rejected }
public enum AdoptionPostState { Pending, Published, Rejected, Closed }
public enum AdoptionRequestState { Pending, Replied, Closed }
public enum UrgentCategory { Injured, Sick, Trapped, Other }
public enum UrgentPostState { Open, Handled, Closed }
public enum CarePlaceKind { Vet, Shelter, MunicipalCare }
public enum StoreEnvironment { Sandbox, Production }
public enum BillingEnvironment { Test, Production }
public enum SubscriptionStatus { Active, InGracePeriod, OnHold, Paused, Canceled, Expired, Revoked }
public enum ReportState { Pending, Reviewed, Dismissed }
public enum AdoptionClosedReason { Adopted, Expired, Withdrawn, AccountDeleted }
public enum ModerationDecisionKind { Approved, Rejected, Hidden, Restored }
