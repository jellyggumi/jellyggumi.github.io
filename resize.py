from PIL import Image

# Function to resize an image
def resize_image(input_path, output_path, size=(500, 500)):
    """
    Resize an image to the specified size.
    
    Parameters:
        input_path (str): Path to the input image.
        output_path (str): Path to save the resized image.
        size (tuple): New size as a tuple (width, height).
    """
    try:
        # Open the image
        with Image.open(input_path) as img:
            # Resize the image
            resized_img = img.resize(size)
            # Save the resized image
            resized_img.save(output_path)
            print(f"Image resized and saved to {output_path}")
    except Exception as e:
        print(f"Error resizing image: {e}")

# Example usage
input_image_path = "INA_water.png"  # Replace with the path to your input image
output_image_path = "INA.png"     # Replace with the path to save the resized image

resize_image(input_image_path, output_image_path)