from __future__ import annotations
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field
from backend.contracts.planner_schema import PlannerContract


class UserRole(str, Enum):
    ADMIN = "admin"
    LEAD_ENGINEER = "lead_engineer"
    DATA_ENGINEER = "data_engineer"
    ANALYST = "analyst"
    GUEST = "guest"


class AccessViolationType(str, Enum):
    RBAC_UNAUTHORIZED = "RBAC_UNAUTHORIZED"
    DOMAIN_OUT_OF_SCOPE = "DOMAIN_OUT_OF_SCOPE"
    PII_CLEARANCE_REQUIRED = "PII_CLEARANCE_REQUIRED"


class AccessViolation(BaseModel):
    violation_type: AccessViolationType
    details: str
    target: Optional[str] = None


class AccessGateResult(BaseModel):
    allowed: bool
    violations: List[AccessViolation] = Field(default_factory=list)
    actor_id: str
    actor_role: UserRole


class SecurityContext(BaseModel):
    user_id: str = Field(..., min_length=1)
    role: UserRole
    allowed_domains: List[str] = Field(default_factory=list)
    pii_clearance: bool = Field(default=False)


class AccessGate:
    """Stage 1.5 Access Gate: Enforces RBAC roles, domain scoping, and PII clearance."""

    AUTHORIZED_PIPELINE_ROLES = {
        UserRole.ADMIN,
        UserRole.LEAD_ENGINEER,
        UserRole.DATA_ENGINEER,
    }

    def evaluate(self, planner: PlannerContract, sec_ctx: SecurityContext) -> AccessGateResult:
        violations: List[AccessViolation] = []

        # 1. RBAC check
        if sec_ctx.role not in self.AUTHORIZED_PIPELINE_ROLES:
            violations.append(
                AccessViolation(
                    violation_type=AccessViolationType.RBAC_UNAUTHORIZED,
                    details=(
                        f"User '{sec_ctx.user_id}' with role '{sec_ctx.role.value}' is not authorized to "
                        f"trigger Stage 2 dbt code generation. Required: admin, lead_engineer, or data_engineer."
                    ),
                    target=sec_ctx.user_id,
                )
            )

        # 2. Domain scoping check
        has_wildcard = "*" in sec_ctx.allowed_domains or sec_ctx.role == UserRole.ADMIN
        user_domains = set(d.lower() for d in sec_ctx.allowed_domains)

        if not has_wildcard:
            # Check planner level domain
            if planner.domain.lower() not in user_domains:
                violations.append(
                    AccessViolation(
                        violation_type=AccessViolationType.DOMAIN_OUT_OF_SCOPE,
                        details=(
                            f"Planner root domain '{planner.domain}' is outside user allowed domains: "
                            f"{list(user_domains)}."
                        ),
                        target=planner.domain,
                    )
                )

            # Check each model domain
            for model in planner.models:
                if model.domain.lower() not in user_domains:
                    violations.append(
                        AccessViolation(
                            violation_type=AccessViolationType.DOMAIN_OUT_OF_SCOPE,
                            details=(
                                f"Model '{model.name}' domain '{model.domain}' is outside user allowed domains: "
                                f"{list(user_domains)}."
                            ),
                            target=model.name,
                        )
                    )

        # 3. PII clearance check
        if not sec_ctx.pii_clearance:
            for model in planner.models:
                for col in model.columns:
                    if col.is_pii or col.pii_type:
                        violations.append(
                            AccessViolation(
                                violation_type=AccessViolationType.PII_CLEARANCE_REQUIRED,
                                details=(
                                    f"Column '{col.name}' in model '{model.name}' contains PII ({col.pii_type or 'UNSPECIFIED'}), "
                                    f"but user '{sec_ctx.user_id}' lacks PII clearance."
                                ),
                                target=f"{model.name}.{col.name}",
                            )
                        )

        allowed = len(violations) == 0
        return AccessGateResult(
            allowed=allowed,
            violations=violations,
            actor_id=sec_ctx.user_id,
            actor_role=sec_ctx.role,
        )
