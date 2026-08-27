// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAgentCapabilityEscrow
 * @notice Multi-rail capability purchase escrow for TurboDex / NodeZero Agent Exchange on Status Network L2 (Linea zkEVM).
 */
interface IAgentCapabilityEscrow {
    enum EscrowState {
        None,
        Created,
        Funded,
        Settled,
        Refunded
    }

    struct EscrowAgreement {
        address buyer;
        address provider;
        uint256 amount;
        uint256 deadline;
        bytes32 deliverableDigest;
        EscrowState state;
        uint256 createdAt;
        uint256 settledAt;
    }

    event EscrowCreated(
        bytes32 indexed agreementId,
        address indexed buyer,
        address indexed provider,
        uint256 amount,
        uint256 deadline,
        bytes32 deliverableDigest
    );

    event EscrowFunded(
        bytes32 indexed agreementId,
        address indexed buyer,
        uint256 amount
    );

    event EscrowSettled(
        bytes32 indexed agreementId,
        address indexed provider,
        uint256 amount,
        bytes32 deliverableDigest
    );

    event EscrowRefunded(
        bytes32 indexed agreementId,
        address indexed buyer,
        uint256 amount
    );

    function createEscrow(
        bytes32 agreementId,
        address provider,
        uint256 deadline,
        bytes32 deliverableDigest
    ) external payable;

    function releaseFunds(
        bytes32 agreementId,
        bytes32 verifiedDigest
    ) external;

    function refundExpired(bytes32 agreementId) external;

    function getEscrow(bytes32 agreementId)
        external
        view
        returns (EscrowAgreement memory);
}

/**
 * @title AgentCapabilityEscrow
 * @dev Autonomous on-chain capability settlement contract for decentralized agents on Status Network L2.
 */
contract AgentCapabilityEscrow is IAgentCapabilityEscrow {
    mapping(bytes32 => EscrowAgreement) public escrows;

    modifier onlyBuyer(bytes32 agreementId) {
        require(
            msg.sender == escrows[agreementId].buyer,
            "AgentCapabilityEscrow: caller is not the buyer"
        );
        _;
    }

    modifier inState(bytes32 agreementId, EscrowState expectedState) {
        require(
            escrows[agreementId].state == expectedState,
            "AgentCapabilityEscrow: invalid escrow state"
        );
        _;
    }

    /**
     * @notice Creates and simultaneously funds an escrow for a requested agent capability.
     */
    function createEscrow(
        bytes32 agreementId,
        address provider,
        uint256 deadline,
        bytes32 deliverableDigest
    ) external payable override {
        require(agreementId != bytes32(0), "Invalid agreement ID");
        require(provider != address(0), "Invalid provider address");
        require(provider != msg.sender, "Provider cannot be buyer");
        require(deadline > block.timestamp, "Deadline must be in future");
        require(msg.value > 0, "Escrow deposit must be > 0");
        require(
            escrows[agreementId].state == EscrowState.None,
            "Escrow already exists"
        );

        escrows[agreementId] = EscrowAgreement({
            buyer: msg.sender,
            provider: provider,
            amount: msg.value,
            deadline: deadline,
            deliverableDigest: deliverableDigest,
            state: EscrowState.Funded,
            createdAt: block.timestamp,
            settledAt: 0
        });

        emit EscrowCreated(
            agreementId,
            msg.sender,
            provider,
            msg.value,
            deadline,
            deliverableDigest
        );

        emit EscrowFunded(agreementId, msg.sender, msg.value);
    }

    /**
     * @notice Releases escrowed funds to the provider upon delivery verification.
     */
    function releaseFunds(
        bytes32 agreementId,
        bytes32 verifiedDigest
    ) external override onlyBuyer(agreementId) inState(agreementId, EscrowState.Funded) {
        EscrowAgreement storage agreement = escrows[agreementId];
        require(
            agreement.deliverableDigest == bytes32(0) ||
                agreement.deliverableDigest == verifiedDigest,
            "AgentCapabilityEscrow: deliverable digest mismatch"
        );

        agreement.state = EscrowState.Settled;
        agreement.settledAt = block.timestamp;

        uint256 payout = agreement.amount;
        (bool sent, ) = payable(agreement.provider).call{value: payout}("");
        require(sent, "AgentCapabilityEscrow: payout transfer failed");

        emit EscrowSettled(agreementId, agreement.provider, payout, verifiedDigest);
    }

    /**
     * @notice Refunds escrowed deposit to the buyer after the deadline has elapsed.
     */
    function refundExpired(bytes32 agreementId) external override inState(agreementId, EscrowState.Funded) {
        EscrowAgreement storage agreement = escrows[agreementId];
        require(
            block.timestamp >= agreement.deadline,
            "AgentCapabilityEscrow: deadline has not passed"
        );

        agreement.state = EscrowState.Refunded;
        agreement.settledAt = block.timestamp;

        uint256 refundAmount = agreement.amount;
        (bool sent, ) = payable(agreement.buyer).call{value: refundAmount}("");
        require(sent, "AgentCapabilityEscrow: refund transfer failed");

        emit EscrowRefunded(agreementId, agreement.buyer, refundAmount);
    }

    /**
     * @notice Queries the full agreement state for an escrow identifier.
     */
    function getEscrow(bytes32 agreementId)
        external
        view
        override
        returns (EscrowAgreement memory)
    {
        return escrows[agreementId];
    }
}
