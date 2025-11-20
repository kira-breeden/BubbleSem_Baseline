import pandas as pd
import sys

def create_masking_sublists(input_csv, sublist_num):
    """
    Create two versions (A and B) of a trial list with masking_condition column.
    
    Version A: First half = 'all', Second half = 'none'
    Version B: First half = 'none', Second half = 'all'
    
    Parameters:
    - input_csv: path to trial list CSV (e.g., 'trial_list_sublist_1.csv')
    - sublist_num: the sublist number (1-4)
    """
    
    # Load the trial list
    df = pd.read_csv(input_csv)
    
    print(f"\nLoaded {len(df)} trials from {input_csv}")
    
    # Calculate split point (halfway)
    n_trials = len(df)
    halfway = n_trials // 2
    
    print(f"Splitting at trial {halfway} (trials 1-{halfway} vs {halfway+1}-{n_trials})")
    
    # Create Sublist A (first half 'all', second half 'none')
    sublist_a = df.copy()
    sublist_a['masking_condition'] = ['all'] * halfway + ['none'] * (n_trials - halfway)
    
    # Create Sublist B (first half 'none', second half 'all')
    sublist_b = df.copy()
    sublist_b['masking_condition'] = ['none'] * halfway + ['all'] * (n_trials - halfway)
    
    # Save the sublists
    output_a = f'trial_list_sublist_{sublist_num}A.csv'
    output_b = f'trial_list_sublist_{sublist_num}B.csv'
    
    sublist_a.to_csv(output_a, index=False)
    sublist_b.to_csv(output_b, index=False)
    
    print(f"\n✓ Created {output_a}:")
    print(f"  - Trials 1-{halfway}: masking_condition = 'all'")
    print(f"  - Trials {halfway+1}-{n_trials}: masking_condition = 'none'")
    
    print(f"\n✓ Created {output_b}:")
    print(f"  - Trials 1-{halfway}: masking_condition = 'none'")
    print(f"  - Trials {halfway+1}-{n_trials}: masking_condition = 'all'")
    
    return sublist_a, sublist_b


def process_all_sublists():
    """
    Process all four main trial lists and create A/B versions with masking_condition column.
    """
    
    print("="*70)
    print("GENERATING MASKING SUBLISTS (A/B) FOR ALL TRIAL LISTS")
    print("="*70)
    
    all_sublists = []
    
    for sublist_num in range(1, 5):
        input_file = f'trial_list_sublist_{sublist_num}.csv'
        
        print(f"\n{'='*70}")
        print(f"Processing Sublist {sublist_num}")
        print(f"{'='*70}")
        
        try:
            sublist_a, sublist_b = create_masking_sublists(input_file, sublist_num)
            all_sublists.extend([(f'{sublist_num}A', sublist_a), (f'{sublist_num}B', sublist_b)])
        except FileNotFoundError:
            print(f"⚠️  Warning: {input_file} not found. Skipping...")
            continue
    
    # Create a summary showing the counterbalancing
    print(f"\n{'='*70}")
    print("SUMMARY OF MASKING COUNTERBALANCING")
    print(f"{'='*70}\n")
    
    summary_data = []
    for sublist_name, df in all_sublists:
        n_all = (df['masking_condition'] == 'all').sum()
        n_none = (df['masking_condition'] == 'none').sum()
        first_condition = df.iloc[0]['masking_condition']
        second_condition = df.iloc[-1]['masking_condition']
        
        summary_data.append({
            'sublist': sublist_name,
            'total_trials': len(df),
            'all_masked': n_all,
            'none_masked': n_none,
            'first_half': first_condition,
            'second_half': second_condition
        })
    
    summary_df = pd.DataFrame(summary_data)
    print(summary_df.to_string(index=False))
    
    print("\n✓ All sublists created successfully!")
    print("\nYou now have 8 trial lists:")
    for i in range(1, 5):
        print(f"  - trial_list_sublist_{i}A.csv")
        print(f"  - trial_list_sublist_{i}B.csv")
    
    print("\nUsage in experiment:")
    print("  - Each participant gets assigned to one of the 8 sublists (1A, 1B, 2A, 2B, etc.)")
    print("  - URL parameter: ?sublist=1A or ?sublist=2B")
    print("  - Each trial has a 'masking_condition' column with value 'all' or 'none'")
    print("  - Experiment code reads this column to determine how to display words")
    
    print("\nCounterbalancing:")
    print("  - A versions: masked trials first, then baseline trials")
    print("  - B versions: baseline trials first, then masked trials")
    print("  - Each numbered sublist (1-4) has different entropy distributions")
    print("  - Each participant sees 10 'all' trials and 10 'none' trials")
    
    return summary_df


if __name__ == '__main__':
    if len(sys.argv) > 1:
        # Process a single sublist
        input_file = sys.argv[1]
        sublist_num = input_file.split('_')[-1].replace('.csv', '')
        create_masking_sublists(input_file, sublist_num)
    else:
        # Process all sublists
        process_all_sublists()